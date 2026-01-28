defmodule Electric.Shapes.Consumer.MoveHandling do
  @moduledoc """
  Handles move-in and move-out events for shapes with subquery dependencies.

  For DNF-decomposed expressions, this module handles:
  - NOT inversion: move-in to NOT IN becomes move-out, move-out from NOT IN becomes move-in
  - Multiple disjuncts (OR): avoid duplicates on move-in, avoid premature deletion on move-out
  """
  alias Electric.Replication.LogOffset
  alias Electric.ShapeCache.Storage
  alias Electric.Shapes.Consumer.State
  alias Electric.Shapes.PartialModes
  alias Electric.Shapes.Shape
  alias Electric.Shapes.Shape.SubqueryMoves
  alias Electric.Shapes.Consumer.MoveIns

  require Logger

  @spec process_move_ins(State.t(), Shape.handle(), list(term())) ::
          {State.t(), changes :: term()}
  def process_move_ins(state, _, []), do: {state, nil}

  def process_move_ins(%State{shape: shape} = state, dep_handle, new_values) do
    # Get the positions affected by this dependency
    positions = Shape.get_positions_for_dependency(shape, dep_handle)

    if positions == [] do
      # Fall back to legacy behavior if no position mapping
      Logger.debug("process_move_ins: falling back to legacy behavior (no positions)")
      {do_legacy_move_in(state, dep_handle, new_values), nil}
    else
      # Check if any positions are negated
      negated_positions = Enum.filter(positions, &Shape.position_negated?(shape, &1))
      positive_positions = positions -- negated_positions

      {state, notification} =
        if negated_positions != [] do
          # For negated positions (NOT IN), move-in means the row should now be EXCLUDED
          # because the value is now in the subquery, so NOT IN becomes false
          Logger.debug(
            "Move-in to negated positions #{inspect(negated_positions)} from #{dep_handle} - generating move-out"
          )

          do_move_out_for_positions(state, dep_handle, new_values, negated_positions)
        else
          {state, nil}
        end

      if positive_positions != [] do
        # For positive positions (IN), move-in means query for new rows
        # If there are other disjuncts, we should exclude rows already in shape
        {do_move_in_query(state, dep_handle, new_values, positive_positions), notification}
      else
        {state, notification}
      end
    end
  end

  @spec process_move_outs(State.t(), Shape.handle(), list(term())) ::
          {State.t(), changes :: term()}
  def process_move_outs(state, _, []), do: {state, nil}

  def process_move_outs(%State{shape: shape} = state, dep_handle, removed_values) do
    # Get the positions affected by this dependency
    positions = Shape.get_positions_for_dependency(shape, dep_handle)

    if positions == [] do
      # Fall back to legacy behavior if no position mapping
      do_legacy_move_out(state, dep_handle, removed_values)
    else
      # Check if any positions are negated
      negated_positions = Enum.filter(positions, &Shape.position_negated?(shape, &1))
      positive_positions = positions -- negated_positions

      {state, notification} =
        if positive_positions != [] do
          # For positive positions (IN), move-out means the row should be excluded
          # If there are other disjuncts, only exclude if no longer satisfied by any
          do_move_out_for_positions_with_check(state, dep_handle, removed_values, positive_positions)
        else
          {state, nil}
        end

      if negated_positions != [] do
        # For negated positions (NOT IN), move-out means the row should now be INCLUDED
        # because the value is no longer in the subquery, so NOT IN becomes true
        Logger.debug(
          "Move-out from negated positions #{inspect(negated_positions)} from #{dep_handle} - querying for new rows"
        )

        # removed_values is already in {tag, value} tuple format from the materializer
        # which is exactly what do_move_in_query expects
        # Pass remove_not: true to strip NOT from the WHERE clause
        new_state = do_move_in_query(state, dep_handle, removed_values, negated_positions, remove_not: true)
        {new_state, notification}
      else
        {state, notification}
      end
    end
  end

  # Legacy move-in behavior for single-subquery shapes without DNF
  defp do_legacy_move_in(%State{} = state, dep_handle, new_values) do
    formed_where_clause =
      SubqueryMoves.move_in_where_clause(
        state.shape,
        dep_handle,
        Enum.map(new_values, &elem(&1, 1))
      )

    do_move_in_with_where(state, dep_handle, new_values, formed_where_clause)
  end

  # Query for new rows to add to the shape
  # Options:
  # - :remove_not - if true, removes NOT from the WHERE clause (for NOT IN shapes)
  defp do_move_in_query(%State{shape: shape} = state, dep_handle, new_values, _positions, opts \\ []) do
    # Build the WHERE clause for the move-in query
    values = Enum.map(new_values, &elem(&1, 1))

    formed_where_clause =
      SubqueryMoves.move_in_where_clause(shape, dep_handle, values, opts)


    # If there are multiple disjuncts, we should exclude rows already in shape via other disjuncts
    # For now, we use the standard query - deduplication will be handled later
    # TODO: Add exclusion clause for other disjuncts (Task #3)

    do_move_in_with_where(state, dep_handle, new_values, formed_where_clause)
  end

  # Execute the move-in query with the given WHERE clause
  defp do_move_in_with_where(%State{} = state, dep_handle, new_values, formed_where_clause) do
    storage = state.storage
    name = Electric.Utils.uuid4()
    consumer_pid = self()

    # Start async query - don't block on snapshot
    Electric.ProcessRegistry.name(state.stack_id, Electric.StackTaskSupervisor)
    |> PartialModes.query_move_in_async(
      state.shape_handle,
      state.shape,
      formed_where_clause,
      stack_id: state.stack_id,
      consumer_pid: consumer_pid,
      results_fn: fn stream, pg_snapshot ->
        task_pid = self()

        # Process query results
        stream
        |> Stream.transform(
          fn -> [] end,
          fn [key, _, _] = item, acc -> {[item], [key | acc]} end,
          fn acc -> send(task_pid, {:acc, acc, pg_snapshot}) end
        )
        |> Storage.write_move_in_snapshot!(name, storage)

        # Return accumulated keys and snapshot
        receive(do: ({:acc, acc, snapshot} -> {acc, snapshot}))
      end,
      move_in_name: name
    )

    index = Enum.find_index(state.shape.shape_dependencies_handles, &(&1 == dep_handle))

    # Add to waiting WITHOUT blocking (snapshot will be set later via message)
    move_handling_state =
      MoveIns.add_waiting(
        state.move_handling_state,
        name,
        {["$sublink", Integer.to_string(index)], MapSet.new(Enum.map(new_values, &elem(&1, 0)))}
      )

    Logger.debug("Move-in #{name} has been triggered from #{dep_handle}")

    %{state | move_handling_state: move_handling_state}
  end

  # Generate move-out messages for negated positions (when move-in should cause exclusion)
  defp do_move_out_for_positions(state, dep_handle, values, _positions) do
    # The values coming from move-in are already {tag, value} tuples
    # which is the format expected by do_legacy_move_out
    # Return {state, notification} so the notification can be propagated
    do_legacy_move_out(state, dep_handle, values)
  end

  # Generate move-out messages with check for other disjuncts
  defp do_move_out_for_positions_with_check(state, dep_handle, removed_values, _positions) do
    # TODO: If shape has multiple disjuncts, we should only generate move-out for rows
    # that are no longer satisfied by ANY disjunct. For now, use legacy behavior.
    # The client will need to use tags to determine if row should actually be removed.
    do_legacy_move_out(state, dep_handle, removed_values)
  end

  # Legacy move-out behavior
  defp do_legacy_move_out(state, dep_handle, removed_values) do
    message =
      SubqueryMoves.make_move_out_control_message(
        state.shape,
        state.stack_id,
        state.shape_handle,
        [
          {dep_handle, removed_values}
        ]
      )

    # Track the move-out for filtering
    move_handling_state =
      MoveIns.move_out_happened(
        state.move_handling_state,
        MapSet.new(message.headers.patterns |> Enum.map(& &1[:value]))
      )

    {{_, upper_bound}, writer} = Storage.append_control_message!(message, state.writer)

    {%{state | move_handling_state: move_handling_state, writer: writer},
     {[message], upper_bound}}
  end

  def query_complete(%State{} = state, name, key_set, snapshot) do
    # 1. Splice stored snapshot into main log with filtering
    {{lower_bound, upper_bound}, writer} =
      Storage.append_move_in_snapshot_to_log_filtered!(
        name,
        state.writer,
        state.move_handling_state.touch_tracker,
        snapshot,
        state.move_handling_state.moved_out_tags[name] || MapSet.new()
      )

    # 2. Move from "waiting" to "filtering"
    {visibility_snapshot, move_handling_state} =
      MoveIns.change_to_filtering(state.move_handling_state, name, MapSet.new(key_set))

    {{_, upper_bound}, writer} =
      if is_nil(visibility_snapshot) do
        {{nil, upper_bound}, writer}
      else
        append_snapshot_end_control(snapshot, writer)
      end

    state = %{state | move_handling_state: move_handling_state, writer: writer}

    {state, {{lower_bound, upper_bound}, upper_bound}}
  end

  @spec append_snapshot_end_control(MoveIns.pg_snapshot(), Storage.writer_state()) ::
          {{LogOffset.t(), LogOffset.t()}, Storage.writer_state()}
  defp append_snapshot_end_control({xmin, xmax, xip_list}, writer) do
    control_message = %{
      headers: %{
        control: "snapshot-end",
        xmin: Integer.to_string(xmin),
        xmax: Integer.to_string(xmax),
        xip_list: Enum.map(xip_list, &Integer.to_string/1)
      }
    }

    Storage.append_control_message!(control_message, writer)
  end
end
