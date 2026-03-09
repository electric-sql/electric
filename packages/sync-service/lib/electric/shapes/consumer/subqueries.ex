defmodule Electric.Shapes.Consumer.Subqueries do
  @moduledoc false

  alias Electric.Postgres.Lsn
  alias Electric.Replication.Changes
  alias Electric.Replication.Changes.Transaction
  alias Electric.Shapes.Consumer.Subqueries.Buffering
  alias Electric.Shapes.Consumer.Subqueries.Steady
  alias Electric.Shapes.Consumer.Subqueries.StateMachine
  alias Electric.Shapes.Shape

  @type move_value() :: {term(), term()}
  @type queue_op() :: {:move_in, move_value()} | {:move_out, move_value()}
  @type move_out_control() :: %{headers: %{event: String.t(), patterns: [map()]}}
  @type output() :: Changes.change() | move_out_control()

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

      {index, {:move_out, move_value}} ->
        {_op, queue} = List.pop_at(state.queue, index)

        next_state =
          %{
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

  @spec namespace_value(nil | binary()) :: binary()
  def namespace_value(nil), do: "NULL"
  def namespace_value(value), do: "v:" <> value

  @spec make_value_hash(binary(), binary(), nil | binary()) :: binary()
  def make_value_hash(stack_id, shape_handle, value) do
    make_value_hash_raw(stack_id, shape_handle, namespace_value(value))
  end

  @spec make_value_hash_raw(binary(), binary(), binary()) :: binary()
  def make_value_hash_raw(stack_id, shape_handle, namespaced_value) do
    :crypto.hash(:md5, "#{stack_id}#{shape_handle}#{namespaced_value}")
    |> Base.encode16(case: :lower)
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

    index = eligible_move_out_index || 0
    {index, Enum.at(queue, index)}
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
