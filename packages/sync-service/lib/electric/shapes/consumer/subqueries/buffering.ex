defmodule Electric.Shapes.Consumer.Subqueries.Buffering do
  @moduledoc false

  alias Electric.Shapes.Consumer.Subqueries.MoveQueue
  alias Electric.Shapes.Consumer.Subqueries.Steady

  @enforce_keys [
    :shape,
    :stack_id,
    :shape_handle,
    :dnf_plan,
    :trigger_dep_index,
    :move_in_values,
    :views_before_move,
    :views_after_move,
    :latest_seen_lsn
  ]
  defstruct [
    :shape,
    :stack_id,
    :shape_handle,
    :dnf_plan,
    :trigger_dep_index,
    :move_in_values,
    :views_before_move,
    :views_after_move,
    dependency_handle_to_ref: %{},
    snapshot: nil,
    move_in_rows: nil,
    move_in_lsn: nil,
    latest_seen_lsn: nil,
    boundary_txn_count: nil,
    buffered_txns: [],
    queue: MoveQueue.new(),
    query_started?: false
  ]

  @type t() :: %__MODULE__{
          shape: Electric.Shapes.Shape.t(),
          stack_id: String.t(),
          shape_handle: String.t(),
          dnf_plan: Electric.Shapes.DnfPlan.t(),
          trigger_dep_index: non_neg_integer(),
          move_in_values: [Electric.Shapes.Consumer.Subqueries.move_value()],
          views_before_move: %{[String.t()] => MapSet.t()},
          views_after_move: %{[String.t()] => MapSet.t()},
          dependency_handle_to_ref: %{String.t() => {non_neg_integer(), [String.t()]}},
          snapshot: {term(), term(), [term()]} | nil,
          move_in_rows: [term()] | nil,
          move_in_lsn: Electric.Postgres.Lsn.t() | nil,
          latest_seen_lsn: Electric.Postgres.Lsn.t() | nil,
          boundary_txn_count: non_neg_integer() | nil,
          buffered_txns: [Electric.Replication.Changes.Transaction.t()],
          queue: MoveQueue.t(),
          query_started?: boolean()
        }

  @spec from_steady(
          Steady.t(),
          non_neg_integer(),
          [String.t()],
          [Electric.Shapes.Consumer.Subqueries.move_value()],
          MoveQueue.t()
        ) :: t()
  def from_steady(%Steady{} = state, dep_index, subquery_ref, move_in_values, queue) do
    views_after =
      Map.update!(state.views, subquery_ref, &add_move_in_values(&1, move_in_values))

    %__MODULE__{
      shape: state.shape,
      stack_id: state.stack_id,
      shape_handle: state.shape_handle,
      dnf_plan: state.dnf_plan,
      trigger_dep_index: dep_index,
      move_in_values: move_in_values,
      views_before_move: state.views,
      views_after_move: views_after,
      dependency_handle_to_ref: state.dependency_handle_to_ref,
      latest_seen_lsn: state.latest_seen_lsn,
      queue: queue
    }
  end

  defp add_move_in_values(subquery_view, move_in_values) do
    Enum.reduce(move_in_values, subquery_view, fn {value, _original_value}, view ->
      MapSet.put(view, value)
    end)
  end
end

defimpl Electric.Shapes.Consumer.Subqueries.StateMachine,
  for: Electric.Shapes.Consumer.Subqueries.Buffering do
  alias Electric.Replication.Changes.LsnUpdate
  alias Electric.Replication.Changes.Transaction
  alias Electric.Shapes.Consumer.Subqueries
  alias Electric.Shapes.Consumer.Subqueries.MoveQueue

  def handle_event(state, %Transaction{} = txn) do
    next_state =
      state
      |> Subqueries.maybe_buffer_boundary_from_txn(txn)
      |> Map.update!(:buffered_txns, &(&1 ++ [txn]))

    Subqueries.maybe_splice(next_state)
  end

  def handle_event(state, %LsnUpdate{lsn: lsn}) do
    state
    |> Map.put(:latest_seen_lsn, lsn)
    |> Subqueries.maybe_buffer_boundary_from_lsn(lsn)
    |> Subqueries.maybe_splice()
  end

  def handle_event(state, {:materializer_changes, dep_handle, payload}) do
    :ok = Subqueries.validate_dependency_handle!(state, dep_handle)
    {dep_index, subquery_ref} = Map.fetch!(state.dependency_handle_to_ref, dep_handle)
    dep_view = Map.get(state.views_after_move, subquery_ref, MapSet.new())

    {[],
     Map.update!(
       state,
       :queue,
       &MoveQueue.enqueue(&1, dep_index, payload, dep_view)
     )}
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
    |> Subqueries.maybe_buffer_boundary_from_seen_lsn()
    |> Subqueries.maybe_splice()
  end
end
