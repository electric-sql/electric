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
  alias Electric.Shapes.Consumer.Subqueries.QueryRow
  alias Electric.Shapes.Consumer.Subqueries.Steady
  alias Electric.Shapes.Consumer.Subqueries.StateMachine
  alias Electric.Shapes.Querying
  alias Electric.Shapes.Shape
  alias Electric.Utils

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
      dependency_handle: fetch_opt!(opts, :dependency_handle),
      subquery_ref: fetch_opt!(opts, :subquery_ref),
      subquery_view: Map.get(opts, :subquery_view, MapSet.new()),
      queue: []
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
      move_in_where_clause(
        consumer_state.shape,
        consumer_state.subquery_state.dependency_handle,
        [elem(buffering_state.move_in_value, 0)],
        buffering_state.subquery_view_before_move_in
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

  @spec move_in_where_clause(Shape.t(), Shape.handle(), [term()], Enumerable.t()) ::
          {String.t(), [list()]}
  def move_in_where_clause(
        %Shape{
          where: %{query: query, used_refs: used_refs},
          shape_dependencies: shape_dependencies,
          shape_dependencies_handles: shape_dependencies_handles,
          subquery_comparison_expressions: comparison_expressions
        },
        shape_handle,
        move_ins,
        current_view
      ) do
    index = Enum.find_index(shape_dependencies_handles, &(&1 == shape_handle))
    target_section = Enum.at(shape_dependencies, index) |> rebuild_subquery_section()
    subquery_ref = ["$sublink", Integer.to_string(index)]
    comparison_expr = Map.fetch!(comparison_expressions, subquery_ref)
    lhs_sql = comparison_sql(comparison_expr)
    current_view = Enum.to_list(current_view)

    case used_refs[subquery_ref] do
      {:array, {:row, cols}} ->
        {inclusion_sql, inclusion_params} = composite_membership_sql(cols, move_ins, 1)

        {exclusion_sql, exclusion_params} =
          composite_membership_sql(cols, current_view, length(cols) + 1)

        replacement = "#{inclusion_sql} AND NOT #{lhs_sql} #{exclusion_sql}"

        {String.replace(query, target_section, replacement), inclusion_params ++ exclusion_params}

      _col ->
        type = Electric.Replication.Eval.type_to_pg_cast(comparison_expr.returns)

        replacement =
          "= ANY ($1::#{type}[]) AND NOT #{lhs_sql} = ANY ($2::#{type}[])"

        {String.replace(query, target_section, replacement), [move_ins, current_view]}
    end
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

  @spec enqueue_materializer_ops([queue_op()], map()) :: [queue_op()]
  def enqueue_materializer_ops(queue, payload) do
    new_ops =
      Enum.map(Map.get(payload, :move_out, []), &{:move_out, &1}) ++
        Enum.map(Map.get(payload, :move_in, []), &{:move_in, &1})

    queue ++ new_ops
  end

  @spec drain_queue(Steady.t(), [output()]) :: {[output()], Steady.t() | Buffering.t()}
  def drain_queue(%Steady{} = state, outputs \\ []) do
    case next_queue_op(state.queue, state.subquery_view) do
      nil ->
        {outputs, state}

      {index, :skip} ->
        {_op, queue} = List.pop_at(state.queue, index)
        drain_queue(%{state | queue: queue}, outputs)

      {index, {:move_out, move_value}} ->
        {_op, queue} = List.pop_at(state.queue, index)

        next_state = %{
          state
          | queue: queue,
            subquery_view: MapSet.delete(state.subquery_view, elem(move_value, 0))
        }

        drain_queue(
          next_state,
          outputs ++ [make_move_out_control_message(next_state, [move_value])]
        )

      {index, {:move_in, move_value}} ->
        {_op, queue} = List.pop_at(state.queue, index)
        {outputs, Buffering.from_steady(state, move_value, queue)}
    end
  end

  @spec maybe_splice(Buffering.t()) :: {[output()], Steady.t() | Buffering.t()}
  def maybe_splice(%Buffering{} = state) do
    if ready_to_splice?(state) do
      {pre_txns, post_txns} = Enum.split(state.buffered_txns, state.boundary_txn_count)

      outputs =
        Enum.flat_map(
          pre_txns,
          &convert_transaction(&1, state, state.subquery_view_before_move_in)
        ) ++
          state.move_in_rows ++
          Enum.flat_map(
            post_txns,
            &convert_transaction(&1, state, state.subquery_view_after_move_in)
          )

      state
      |> to_steady_state()
      |> drain_queue(outputs)
    else
      {[], state}
    end
  end

  @spec convert_transaction(Transaction.t(), Steady.t() | Buffering.t(), MapSet.t()) :: [
          Changes.change()
        ]
  def convert_transaction(%Transaction{changes: changes}, %{shape: shape} = state, subquery_view) do
    refs = %{state.subquery_ref => subquery_view}

    changes
    |> Enum.flat_map(fn change ->
      Shape.convert_change(shape, change,
        stack_id: state.stack_id,
        shape_handle: state.shape_handle,
        extra_refs: {refs, refs}
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

  @spec validate_dependency_handle!(Steady.t() | Buffering.t(), term()) :: :ok
  def validate_dependency_handle!(%{dependency_handle: expected}, actual) when expected == actual,
    do: :ok

  def validate_dependency_handle!(%{dependency_handle: expected}, actual) do
    raise ArgumentError,
          "expected dependency handle #{inspect(expected)}, got: #{inspect(actual)}"
  end

  @spec make_move_out_control_message(Steady.t() | Buffering.t(), [move_value()]) ::
          move_out_control()
  def make_move_out_control_message(
        %{shape: shape, stack_id: stack_id, shape_handle: shape_handle},
        values
      ) do
    %{
      headers: %{
        event: "move-out",
        patterns: make_move_out_patterns(shape.tag_structure, stack_id, shape_handle, values)
      }
    }
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

  defp composite_membership_sql(cols, values, first_param_index) do
    casts = Enum.map(cols, &Electric.Replication.Eval.type_to_pg_cast/1)

    params =
      case values do
        [] -> Enum.map(casts, fn _ -> [] end)
        values -> values |> Utils.unzip_any() |> Tuple.to_list()
      end

    sql =
      casts
      |> Enum.with_index(first_param_index)
      |> Enum.map_join(", ", fn {col, index} -> "$#{index}::#{col}[]" end)
      |> then(&"IN (SELECT * FROM unnest(#{&1}))")

    {sql, params}
  end

  defp rebuild_subquery_section(shape) do
    base =
      ~s|IN (SELECT #{Enum.join(shape.explicitly_selected_columns, ", ")} FROM #{Utils.relation_to_sql(shape.root_table)}|

    where = if shape.where, do: " WHERE #{shape.where.query}", else: ""
    base <> where <> ")"
  end

  defp comparison_sql(%Eval.Expr{eval: %Eval.Parser.Ref{path: [column_name]}}), do: column_name

  defp comparison_sql(%Eval.Expr{eval: %Eval.Parser.RowExpr{elements: elements}}) do
    columns =
      Enum.map(elements, fn %Eval.Parser.Ref{path: [column_name]} ->
        column_name
      end)

    "(" <> Enum.join(columns, ", ") <> ")"
  end

  defp make_move_out_patterns(tag_structure, stack_id, shape_handle, values) do
    Enum.flat_map(tag_structure, fn [column_or_expr] ->
      Enum.map(values, fn {_typed_value, original_value} ->
        %{
          pos: 0,
          value: make_pattern_hash(column_or_expr, stack_id, shape_handle, original_value)
        }
      end)
    end)
  end

  defp make_pattern_hash(column_name, stack_id, shape_handle, value)
       when is_binary(column_name) do
    make_value_hash(stack_id, shape_handle, value)
  end

  defp make_pattern_hash({:hash_together, columns}, stack_id, shape_handle, original_value) do
    namespaced_value =
      original_value
      |> Tuple.to_list()
      |> Enum.zip_with(columns, fn value, column ->
        column <> ":" <> namespace_value(value)
      end)
      |> Enum.join()

    make_value_hash_raw(stack_id, shape_handle, namespaced_value)
  end

  defp to_steady_state(%Buffering{} = state) do
    %Steady{
      shape: state.shape,
      stack_id: state.stack_id,
      shape_handle: state.shape_handle,
      dependency_handle: state.dependency_handle,
      subquery_ref: state.subquery_ref,
      subquery_view: state.subquery_view_after_move_in,
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

  defp next_queue_op([], _subquery_view), do: nil

  defp next_queue_op(queue, subquery_view) do
    eligible_move_out_index =
      queue
      |> Enum.with_index()
      |> Enum.find_value(fn
        {{:move_out, {value, _}}, index} ->
          if MapSet.member?(subquery_view, value) and
               no_earlier_op_for_value?(queue, index, value),
             do: index

        _ ->
          nil
      end)

    cond do
      not is_nil(eligible_move_out_index) ->
        {eligible_move_out_index, Enum.at(queue, eligible_move_out_index)}

      match?({:move_out, _}, hd(queue)) ->
        {0, :skip}

      true ->
        {0, hd(queue)}
    end
  end

  defp no_earlier_op_for_value?(queue, index, value) do
    queue
    |> Enum.take(index)
    |> Enum.all?(fn {_op_kind, {other_value, _}} -> other_value != value end)
  end

  defp fetch_opt!(opts, key) do
    case Map.fetch(opts, key) do
      {:ok, value} -> value
      :error -> raise ArgumentError, "missing required option #{inspect(key)}"
    end
  end
end
