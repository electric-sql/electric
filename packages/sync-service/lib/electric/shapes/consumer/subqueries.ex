defmodule Electric.Shapes.Consumer.Subqueries do
  @moduledoc false

  alias Electric.Connection.Manager
  alias Electric.Postgres.Lsn
  alias Electric.Postgres.SnapshotQuery
  alias Electric.Replication.Changes
  alias Electric.Replication.Changes.Transaction
  alias Electric.Replication.Eval
  alias Electric.Replication.Eval.Walker
  alias Electric.Shapes.Consumer.Subqueries.Buffering
  alias Electric.Shapes.Consumer.Subqueries.MoveQueue
  alias Electric.Shapes.Consumer.Subqueries.QueryRow
  alias Electric.Shapes.Consumer.Subqueries.Steady
  alias Electric.Shapes.Consumer.Subqueries.StateMachine
  alias Electric.Shapes.DnfPlan
  alias Electric.Shapes.Querying
  alias Electric.Shapes.Shape

  @value_prefix "v:"
  @null_sentinel "NULL"

  @type move_value() :: {term(), term()}
  @type queue_op() :: {:move_in, move_value()} | {:move_out, move_value()}
  @type move_out_control() :: %{headers: %{event: String.t(), patterns: [map()]}}
  @type output() :: Changes.change() | move_out_control() | QueryRow.t()

  def value_prefix, do: @value_prefix
  def null_sentinel, do: @null_sentinel

  @spec new(keyword() | map()) :: Steady.t()
  def new(opts) when is_list(opts) or is_map(opts) do
    opts = Map.new(opts)

    %Steady{
      shape: fetch_opt!(opts, :shape),
      stack_id: fetch_opt!(opts, :stack_id),
      shape_handle: fetch_opt!(opts, :shape_handle),
      dnf_plan: fetch_opt!(opts, :dnf_plan),
      views: Map.get(opts, :views, %{}),
      dependency_handle_to_ref: Map.get(opts, :dependency_handle_to_ref, %{}),
      latest_seen_lsn: Map.get(opts, :latest_seen_lsn),
      queue: MoveQueue.new()
    }
  end

  @spec handle_event(Steady.t() | Buffering.t(), term()) ::
          {[output()], Steady.t() | Buffering.t()}
  def handle_event(state, event), do: StateMachine.handle_event(state, event)

  @spec query_move_in_async(pid() | atom(), map(), Buffering.t(), pid()) :: :ok
  def query_move_in_async(
        supervisor,
        consumer_state,
        %Buffering{} = buffering_state,
        consumer_pid
      ) do
    {where, params} =
      DnfPlan.move_in_where_clause(
        buffering_state.dnf_plan,
        buffering_state.trigger_dep_index,
        Enum.map(buffering_state.move_in_values, &elem(&1, 0)),
        buffering_state.views_before_move,
        consumer_state.shape.where.used_refs
      )

    pool = Manager.pool_name(consumer_state.stack_id, :snapshot)
    stack_id = consumer_state.stack_id
    shape = consumer_state.shape
    shape_handle = consumer_state.shape_handle

    :telemetry.execute([:electric, :subqueries, :move_in_triggered], %{count: 1}, %{
      stack_id: stack_id
    })

    Task.Supervisor.start_child(supervisor, fn ->
      try do
        SnapshotQuery.execute_for_shape(pool, shape_handle, shape,
          stack_id: stack_id,
          query_reason: "move_in_query",
          snapshot_info_fn: fn _, pg_snapshot, _lsn ->
            send(consumer_pid, {:pg_snapshot_known, pg_snapshot})
          end,
          query_fn: fn conn, _pg_snapshot, lsn ->
            rows =
              Querying.query_move_in(conn, stack_id, shape_handle, shape, {where, params})
              |> Enum.map(fn [key, _tags, json] -> %QueryRow{key: key, json: json} end)

            send(consumer_pid, {:query_move_in_complete, rows, lsn})
          end
        )
      rescue
        error ->
          send(consumer_pid, {:query_move_in_error, error, __STACKTRACE__})
      end
    end)

    :ok
  end

  @spec move_in_tag_structure(Shape.t()) ::
          {list(list(String.t() | {:hash_together, [String.t(), ...]})), map()}
  def move_in_tag_structure(%Shape{} = shape)
      when is_nil(shape.where)
      when shape.shape_dependencies == [],
      do: {[], %{}}

  def move_in_tag_structure(shape) do
    {:ok, {tag_structure, comparison_expressions}} =
      Walker.reduce(
        shape.where.eval,
        fn
          %Eval.Parser.Func{name: "sublink_membership_check", args: [testexpr, sublink_ref]},
          {[current_tag | others], comparison_expressions},
          _ ->
            tags =
              case testexpr do
                %Eval.Parser.Ref{path: [column_name]} ->
                  [[column_name | current_tag] | others]

                %Eval.Parser.RowExpr{elements: elements} ->
                  elements =
                    Enum.map(elements, fn %Eval.Parser.Ref{path: [column_name]} ->
                      column_name
                    end)

                  [[{:hash_together, elements} | current_tag] | others]
              end

            {:ok, {tags, Map.put(comparison_expressions, sublink_ref.path, testexpr)}}

          _, acc, _ ->
            {:ok, acc}
        end,
        {[[]], %{}}
      )

    comparison_expressions
    |> Map.new(fn {path, expr} -> {path, Eval.Expr.wrap_parser_part(expr)} end)
    |> then(&{tag_structure, &1})
  end

  @spec drain_queue(Steady.t(), [output()]) :: {[output()], Steady.t() | Buffering.t()}
  def drain_queue(%Steady{} = state, outputs \\ []) do
    case MoveQueue.pop_next(state.queue) do
      nil ->
        {outputs, state}

      {{:move_out, dep_index, move_out_values}, queue} ->
        subquery_ref = dep_ref_for_index(state, dep_index)

        next_state = %{
          state
          | queue: queue,
            views:
              Map.update!(state.views, subquery_ref, &remove_move_values(&1, move_out_values))
        }

        broadcast =
          DnfPlan.make_move_out_broadcast(
            state.dnf_plan,
            dep_index,
            move_out_values,
            state.stack_id,
            state.shape_handle
          )

        drain_queue(next_state, outputs ++ [broadcast])

      {{:move_in, dep_index, move_in_values}, queue} ->
        subquery_ref = dep_ref_for_index(state, dep_index)
        {outputs, Buffering.from_steady(state, dep_index, subquery_ref, move_in_values, queue)}
    end
  end

  @spec maybe_splice(Buffering.t()) :: {[output()], Steady.t() | Buffering.t()}
  def maybe_splice(%Buffering{} = state) do
    if ready_to_splice?(state) do
      {pre_txns, post_txns} = Enum.split(state.buffered_txns, state.boundary_txn_count)

      move_in_broadcast =
        DnfPlan.make_move_in_broadcast(
          state.dnf_plan,
          state.trigger_dep_index,
          state.move_in_values,
          state.stack_id,
          state.shape_handle
        )

      outputs =
        Enum.flat_map(
          pre_txns,
          &convert_transaction(&1, state, state.views_before_move)
        ) ++
          [move_in_broadcast] ++
          state.move_in_rows ++
          Enum.flat_map(
            post_txns,
            &convert_transaction(&1, state, state.views_after_move)
          )

      state
      |> to_steady_state()
      |> drain_queue(outputs)
    else
      {[], state}
    end
  end

  @spec convert_transaction(Transaction.t(), Steady.t() | Buffering.t(), map()) :: [
          Changes.change()
        ]
  def convert_transaction(%Transaction{changes: changes}, %{shape: shape} = state, views) do
    changes
    |> Enum.flat_map(fn change ->
      Shape.convert_change(shape, change,
        stack_id: state.stack_id,
        shape_handle: state.shape_handle,
        extra_refs: {views, views}
      )
    end)
    |> mark_last_change()
  end

  @spec maybe_buffer_boundary_from_txn(Buffering.t(), Transaction.t()) :: Buffering.t()
  def maybe_buffer_boundary_from_txn(%Buffering{boundary_txn_count: boundary} = state, _txn)
      when not is_nil(boundary),
      do: state

  def maybe_buffer_boundary_from_txn(%Buffering{snapshot: nil} = state, _txn), do: state

  def maybe_buffer_boundary_from_txn(%Buffering{} = state, %Transaction{} = txn) do
    if Transaction.visible_in_snapshot?(txn, state.snapshot) do
      state
    else
      %{state | boundary_txn_count: length(state.buffered_txns)}
    end
  end

  @spec maybe_buffer_boundary_from_snapshot(Buffering.t()) :: Buffering.t()
  def maybe_buffer_boundary_from_snapshot(%Buffering{boundary_txn_count: boundary} = state)
      when not is_nil(boundary),
      do: state

  def maybe_buffer_boundary_from_snapshot(%Buffering{snapshot: nil} = state), do: state

  def maybe_buffer_boundary_from_snapshot(%Buffering{} = state) do
    case Enum.find_index(
           state.buffered_txns,
           &(not Transaction.visible_in_snapshot?(&1, state.snapshot))
         ) do
      nil -> state
      index -> %{state | boundary_txn_count: index}
    end
  end

  @spec maybe_buffer_boundary_from_lsn(Buffering.t(), Lsn.t()) :: Buffering.t()
  def maybe_buffer_boundary_from_lsn(%Buffering{boundary_txn_count: boundary} = state, _lsn)
      when not is_nil(boundary),
      do: state

  def maybe_buffer_boundary_from_lsn(%Buffering{move_in_lsn: nil} = state, _lsn), do: state

  def maybe_buffer_boundary_from_lsn(%Buffering{} = state, %Lsn{} = lsn) do
    case Lsn.compare(lsn, state.move_in_lsn) do
      :lt -> state
      _ -> %{state | boundary_txn_count: length(state.buffered_txns)}
    end
  end

  @spec maybe_buffer_boundary_from_seen_lsn(Buffering.t()) :: Buffering.t()
  def maybe_buffer_boundary_from_seen_lsn(%Buffering{latest_seen_lsn: nil} = state), do: state

  def maybe_buffer_boundary_from_seen_lsn(%Buffering{} = state) do
    maybe_buffer_boundary_from_lsn(state, state.latest_seen_lsn)
  end

  @spec validate_dependency_handle!(Steady.t() | Buffering.t(), term()) :: :ok
  def validate_dependency_handle!(%{dependency_handle_to_ref: mapping}, dep_handle) do
    unless Map.has_key?(mapping, dep_handle) do
      raise ArgumentError,
            "unexpected dependency handle #{inspect(dep_handle)}, " <>
              "known: #{inspect(Map.keys(mapping))}"
    end

    :ok
  end

  @spec make_move_out_control_message(Steady.t() | Buffering.t(), non_neg_integer(), [
          move_value()
        ]) ::
          move_out_control()
  def make_move_out_control_message(
        %{dnf_plan: dnf_plan, stack_id: stack_id, shape_handle: shape_handle},
        dep_index,
        values
      ) do
    DnfPlan.make_move_out_broadcast(dnf_plan, dep_index, values, stack_id, shape_handle)
  end

  @spec should_skip_query_row?(
          %{String.t() => pos_integer()},
          SnapshotQuery.pg_snapshot(),
          String.t()
        ) ::
          boolean()
  def should_skip_query_row?(touch_tracker, _snapshot, key)
      when not is_map_key(touch_tracker, key),
      do: false

  def should_skip_query_row?(touch_tracker, snapshot, key) do
    touch_xid = Map.fetch!(touch_tracker, key)
    not Transaction.visible_in_snapshot?(touch_xid, snapshot)
  end

  @spec namespace_value(nil | binary()) :: binary()
  def namespace_value(nil), do: @null_sentinel
  def namespace_value(value), do: @value_prefix <> value

  @spec make_value_hash(binary(), binary(), nil | binary()) :: binary()
  def make_value_hash(stack_id, shape_handle, value) do
    make_value_hash_raw(stack_id, shape_handle, namespace_value(value))
  end

  @spec make_value_hash_raw(binary(), binary(), binary()) :: binary()
  def make_value_hash_raw(stack_id, shape_handle, namespaced_value) do
    :crypto.hash(:md5, "#{stack_id}#{shape_handle}#{namespaced_value}")
    |> Base.encode16(case: :lower)
  end

  @doc """
  Returns the subquery ref path for a given dependency index, looking it up
  via the dependency_handle_to_ref mapping.
  """
  def dep_ref_for_index(%{dependency_handle_to_ref: mapping}, dep_index) do
    case Enum.find(mapping, fn {_handle, {idx, _ref}} -> idx == dep_index end) do
      {_handle, {_idx, ref}} -> ref
      nil -> raise ArgumentError, "no dependency found for index #{dep_index}"
    end
  end

  defp to_steady_state(%Buffering{} = state) do
    %Steady{
      shape: state.shape,
      stack_id: state.stack_id,
      shape_handle: state.shape_handle,
      dnf_plan: state.dnf_plan,
      views: state.views_after_move,
      dependency_handle_to_ref: state.dependency_handle_to_ref,
      latest_seen_lsn: state.latest_seen_lsn,
      queue: state.queue
    }
  end

  defp ready_to_splice?(%Buffering{} = state) do
    not is_nil(state.snapshot) and not is_nil(state.move_in_rows) and
      not is_nil(state.boundary_txn_count)
  end

  defp mark_last_change([]), do: []

  defp mark_last_change(changes) do
    {last, rest} = List.pop_at(changes, -1)
    rest ++ [%{last | last?: true}]
  end

  defp remove_move_values(subquery_view, move_values) do
    Enum.reduce(move_values, subquery_view, fn {value, _original_value}, view ->
      MapSet.delete(view, value)
    end)
  end

  defp fetch_opt!(opts, key) do
    case Map.fetch(opts, key) do
      {:ok, value} -> value
      :error -> raise ArgumentError, "missing required option #{inspect(key)}"
    end
  end
end
