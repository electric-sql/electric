defmodule Electric.Shapes.Consumer.Subqueries.Steady do
  @moduledoc false

  alias Electric.Shapes.Consumer.Subqueries.MoveQueue

  @enforce_keys [:shape, :stack_id, :shape_handle, :dnf_plan, :dependency_handle_to_ref]
  defstruct [
    :shape,
    :stack_id,
    :shape_handle,
    :dnf_plan,
    views: %{},
    dependency_handle_to_ref: %{},
    latest_seen_lsn: nil,
    queue: MoveQueue.new()
  ]

  @type t() :: %__MODULE__{
          shape: Electric.Shapes.Shape.t(),
          stack_id: String.t(),
          shape_handle: String.t(),
          dnf_plan: Electric.Shapes.DnfPlan.t(),
          views: %{[String.t()] => MapSet.t()},
          dependency_handle_to_ref: %{String.t() => {non_neg_integer(), [String.t()]}},
          latest_seen_lsn: Electric.Postgres.Lsn.t() | nil,
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
    {Subqueries.convert_transaction(txn, state, state.views), state}
  end

  def handle_event(state, %LsnUpdate{lsn: lsn}), do: {[], %{state | latest_seen_lsn: lsn}}

  def handle_event(state, {:materializer_changes, dep_handle, payload}) do
    :ok = Subqueries.validate_dependency_handle!(state, dep_handle)
    {dep_index, subquery_ref} = Map.fetch!(state.dependency_handle_to_ref, dep_handle)
    dep_view = Map.get(state.views, subquery_ref, MapSet.new())

    state
    |> Map.update!(:queue, &MoveQueue.enqueue(&1, dep_index, payload, dep_view))
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
