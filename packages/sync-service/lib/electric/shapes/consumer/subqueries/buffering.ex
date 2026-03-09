defmodule Electric.Shapes.Consumer.Subqueries.Buffering do
  @moduledoc false

  alias Electric.Shapes.Consumer.Subqueries.Steady

  @enforce_keys [
    :shape,
    :stack_id,
    :shape_handle,
    :dependency_handle,
    :subquery_ref,
    :move_in_value,
    :subquery_view_before_move_in,
    :subquery_view_after_move_in
  ]
  defstruct [
    :shape,
    :stack_id,
    :shape_handle,
    :dependency_handle,
    :subquery_ref,
    :move_in_value,
    :subquery_view_before_move_in,
    :subquery_view_after_move_in,
    snapshot: nil,
    move_in_rows: nil,
    move_in_lsn: nil,
    boundary_txn_count: nil,
    buffered_txns: [],
    queue: []
  ]

  @type t() :: %__MODULE__{
          shape: Electric.Shapes.Shape.t(),
          stack_id: String.t(),
          shape_handle: String.t(),
          dependency_handle: String.t(),
          subquery_ref: [String.t()],
          move_in_value: Electric.Shapes.Consumer.Subqueries.move_value(),
          subquery_view_before_move_in: MapSet.t(),
          subquery_view_after_move_in: MapSet.t(),
          snapshot: {term(), term(), [term()]} | nil,
          move_in_rows: [term()] | nil,
          move_in_lsn: Electric.Postgres.Lsn.t() | nil,
          boundary_txn_count: non_neg_integer() | nil,
          buffered_txns: [Electric.Replication.Changes.Transaction.t()],
          queue: [Electric.Shapes.Consumer.Subqueries.queue_op()]
        }

  @spec from_steady(Steady.t(), Electric.Shapes.Consumer.Subqueries.move_value(), [
          Electric.Shapes.Consumer.Subqueries.queue_op()
        ]) :: t()
  def from_steady(%Steady{} = state, move_in_value, queue) do
    %__MODULE__{
      shape: state.shape,
      stack_id: state.stack_id,
      shape_handle: state.shape_handle,
      dependency_handle: state.dependency_handle,
      subquery_ref: state.subquery_ref,
      move_in_value: move_in_value,
      subquery_view_before_move_in: state.subquery_view,
      subquery_view_after_move_in: MapSet.put(state.subquery_view, elem(move_in_value, 0)),
      queue: queue
    }
  end
end

defimpl Electric.Shapes.Consumer.Subqueries.StateMachine,
  for: Electric.Shapes.Consumer.Subqueries.Buffering do
  alias Electric.Replication.Changes.LsnUpdate
  alias Electric.Replication.Changes.Transaction
  alias Electric.Shapes.Consumer.Subqueries

  def handle_event(state, %Transaction{} = txn) do
    next_state =
      state
      |> Subqueries.maybe_buffer_boundary_from_txn(txn)
      |> Map.update!(:buffered_txns, &(&1 ++ [txn]))

    Subqueries.maybe_splice(next_state)
  end

  def handle_event(state, %LsnUpdate{lsn: lsn}) do
    state
    |> Subqueries.maybe_buffer_boundary_from_lsn(lsn)
    |> Subqueries.maybe_splice()
  end

  def handle_event(state, {:materializer_changes, dep_handle, payload}) do
    :ok = Subqueries.validate_dependency_handle!(state, dep_handle)
    {[], Map.update!(state, :queue, &Subqueries.enqueue_materializer_ops(&1, payload))}
  end

  def handle_event(%{snapshot: snapshot}, {:pg_snapshot_known, _new_snapshot})
      when not is_nil(snapshot) do
    raise ArgumentError, "received {:pg_snapshot_known, snapshot} more than once for one move-in"
  end

  def handle_event(state, {:pg_snapshot_known, snapshot}) do
    state
    |> Map.put(:snapshot, snapshot)
    |> Subqueries.maybe_buffer_boundary_from_snapshot()
    |> Subqueries.maybe_splice()
  end

  def handle_event(%{move_in_rows: rows}, {:query_move_in_complete, _new_rows, _move_in_lsn})
      when not is_nil(rows) do
    raise ArgumentError,
          "received {:query_move_in_complete, rows, move_in_lsn} more than once for one move-in"
  end

  def handle_event(state, {:query_move_in_complete, rows, move_in_lsn}) do
    state
    |> Map.put(:move_in_rows, rows)
    |> Map.put(:move_in_lsn, move_in_lsn)
    |> Subqueries.maybe_splice()
  end
end
