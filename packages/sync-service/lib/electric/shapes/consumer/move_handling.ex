defmodule Electric.Shapes.Consumer.MoveHandling do
  @moduledoc """
  Handles move-in and move-out operations for subquery-based shapes.

  This module orchestrates:
  - Querying the database for move-in data
  - Writing move-in snapshots to storage
  - Generating move-out control messages
  - Completing move-in operations with their key sets
  """

  alias Electric.Shapes.PartialModes
  alias Electric.ShapeCache.Storage
  alias Electric.Shapes.Shape.SubqueryMoves
  alias Electric.Shapes.Consumer.State
  alias Electric.Shapes.Consumer.MoveInOperation
  alias Electric.Shapes.Shape

  @spec process_move_ins(State.t(), Shape.handle(), list(term())) :: State.t()
  def process_move_ins(state, _, []), do: state

  def process_move_ins(state, dep_handle, new_values) do
    # Something moved in in a dependency shape. We need to query the DB for relevant values.
    formed_where_clause =
      Shape.SubqueryMoves.move_in_where_clause(state.shape, dep_handle, new_values)

    storage = state.storage
    name = Electric.Utils.uuid4()

    # We're querying and writing to storage in a separate task, but we're blocking until we know
    # the insertion conditions to know when to start buffering the changes.
    pg_snapshot =
      Electric.ProcessRegistry.name(state.stack_id, Electric.StackTaskSupervisor)
      |> PartialModes.query_move_in(
        state.shape_handle,
        state.shape,
        formed_where_clause,
        stack_id: state.stack_id,
        results_fn: fn stream ->
          stream
          |> Stream.transform(
            fn -> [] end,
            fn [key, _] = item, acc -> {[item], [key | acc]} end,
            fn acc -> send(self(), {:acc, acc}) end
          )
          |> Storage.write_move_in_snapshot!(name, storage)

          receive(do: ({:acc, acc} -> acc))
        end,
        move_in_name: name
      )

    # Create and add the move-in operation
    operation = MoveInOperation.new(name, pg_snapshot)
    State.add_move_in_operation(state, operation)
  end

  @spec process_move_outs(State.t(), Shape.handle(), list(term())) ::
          {State.t(), changes :: term()}
  def process_move_outs(state, _, []), do: {state, nil}

  def process_move_outs(state, dep_handle, removed_values) do
    message =
      SubqueryMoves.make_move_out_control_message(state.shape, [{dep_handle, removed_values}])

    {{_, upper_bound}, writer} = Storage.append_control_message!(message, state.writer)

    {%{state | writer: writer}, {[message], upper_bound}}
  end

  @spec query_complete(State.t(), MoveInOperation.name(), list(String.t())) ::
          {State.t(), notification :: term()}
  def query_complete(state, name, key_set) do
    # 1. Splice the stored data into the main log
    {{_, upper_bound} = bounds, writer} =
      Storage.append_move_in_snapshot_to_log!(name, state.writer)

    # 2. Complete the move-in operation (moves from querying to filtering)
    state = State.complete_move_in(%{state | writer: writer}, name, key_set)

    {state, {bounds, upper_bound}}
  end
end
