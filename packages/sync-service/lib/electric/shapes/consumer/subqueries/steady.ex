defmodule Electric.Shapes.Consumer.Subqueries.Steady do
  @moduledoc false

  alias Electric.Shapes.Consumer.Subqueries.MoveQueue

  @enforce_keys [:shape, :stack_id, :shape_handle, :dependency_handle, :subquery_ref]
  defstruct [
    :shape,
    :stack_id,
    :shape_handle,
    :dependency_handle,
    :subquery_ref,
    latest_seen_lsn: nil,
    subquery_view: MapSet.new(),
    queue: MoveQueue.new()
  ]

  @type t() :: %__MODULE__{
          shape: Electric.Shapes.Shape.t(),
          stack_id: String.t(),
          shape_handle: String.t(),
          dependency_handle: String.t(),
          subquery_ref: [String.t()],
          latest_seen_lsn: Electric.Postgres.Lsn.t() | nil,
          subquery_view: MapSet.t(),
          queue: MoveQueue.t()
        }
end

defimpl Electric.Shapes.Consumer.Subqueries.StateMachine,
  for: Electric.Shapes.Consumer.Subqueries.Steady do
  alias Electric.Replication.Changes.LsnUpdate
  alias Electric.Replication.Changes.Transaction
  alias Electric.Shapes.Consumer.Subqueries
  alias Electric.Shapes.Consumer.Subqueries.MoveQueue

  def handle_event(state, %Transaction{} = txn) do
    {Subqueries.convert_transaction(txn, state, state.subquery_view), state}
  end

  def handle_event(state, %LsnUpdate{lsn: lsn}), do: {[], %{state | latest_seen_lsn: lsn}}

  def handle_event(state, {:materializer_changes, dep_handle, payload}) do
    :ok = Subqueries.validate_dependency_handle!(state, dep_handle)

    state
    |> Map.update!(:queue, &MoveQueue.enqueue(&1, payload, state.subquery_view))
    |> Subqueries.drain_queue()
  end

  def handle_event(_state, {:pg_snapshot_known, _snapshot}) do
    raise ArgumentError, "received {:pg_snapshot_known, snapshot} while no move-in is buffering"
  end

  def handle_event(_state, {:query_move_in_complete, _rows, _move_in_lsn}) do
    raise ArgumentError,
          "received {:query_move_in_complete, rows, move_in_lsn} while no move-in is buffering"
  end
end
