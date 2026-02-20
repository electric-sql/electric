defmodule Electric.Shapes.Consumer.MoveHandling do
  @moduledoc false
  alias Electric.Replication.LogOffset
  alias Electric.ShapeCache.Storage
  alias Electric.Shapes.Consumer.DnfContext
  alias Electric.Shapes.Consumer.State
  alias Electric.Shapes.PartialModes
  alias Electric.Shapes.Shape
  alias Electric.Shapes.Shape.SubqueryMoves
  alias Electric.Shapes.Consumer.MoveIns

  require Logger

  @spec process_move_ins(State.t(), Shape.handle(), list(term())) ::
          {State.t(), changes :: term()}
  def process_move_ins(state, _, []), do: {state, nil}

  def process_move_ins(%State{} = state, dep_handle, new_values) do
    case get_negation_split(state.dnf_context, dep_handle) do
      nil ->
        if dep_has_no_dnf_positions?(state.dnf_context, dep_handle) do
          # DNF context exists but this dep has no positions — it's a nested
          # dependency that will be handled by the dependency chain, skip it.
          {state, nil}
        else
          # No DNF context — existing behavior (all positive)
          {do_start_move_in_query(state, dep_handle, new_values), nil}
        end

      {positive_positions, negated_positions} ->
        # Negated positions: move-in to subquery = deactivation (NOT IN now false)
        {state, notification} =
          if negated_positions != [] do
            do_broadcast_deactivation(state, dep_handle, new_values)
          else
            {state, nil}
          end

        # Positive positions: move-in = query for new rows
        state =
          if positive_positions != [] do
            do_start_move_in_query(state, dep_handle, new_values)
          else
            state
          end

        {state, notification}
    end
  end

  @spec process_move_outs(State.t(), Shape.handle(), list(term())) ::
          {State.t(), changes :: term()}
  def process_move_outs(state, _, []), do: {state, nil}

  def process_move_outs(%State{} = state, dep_handle, removed_values) do
    case get_negation_split(state.dnf_context, dep_handle) do
      nil ->
        if dep_has_no_dnf_positions?(state.dnf_context, dep_handle) do
          # DNF context exists but this dep has no positions — it's a nested
          # dependency that will be handled by the dependency chain, skip it.
          {state, nil}
        else
          # No DNF context — existing behavior (all positive)
          do_broadcast_deactivation(state, dep_handle, removed_values)
        end

      {positive_positions, negated_positions} ->
        # Positive positions: move-out = deactivation broadcast
        {state, notification} =
          if positive_positions != [] do
            do_broadcast_deactivation(state, dep_handle, removed_values)
          else
            {state, nil}
          end

        # Negated positions: move-out from subquery = activation (NOT IN now true) → query
        state =
          if negated_positions != [] do
            do_start_move_in_query(state, dep_handle, removed_values, remove_not: true)
          else
            state
          end

        {state, notification}
    end
  end

  def query_complete(%State{} = state, name, key_set, snapshot) do
    # Filter moved_out_tags to only include positions relevant to this move-in's
    # dependency. Without this, move-out patterns from unrelated dependencies can
    # incorrectly filter rows (especially when different positions use the same column).
    condition_hashes_to_skip = filter_moved_out_tags_for_dependency(state, name)

    # 1. Splice stored snapshot into main log with position-aware filtering
    {{lower_bound, upper_bound}, writer} =
      Storage.append_move_in_snapshot_to_log_filtered!(
        name,
        state.writer,
        state.move_handling_state.touch_tracker,
        snapshot,
        condition_hashes_to_skip
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

  # --- Private helpers ---

  # Filter moved_out_tags for a move-in to only include positions that belong to
  # the same dependency that triggered the move-in. This prevents cross-dependency
  # contamination: e.g., a move-out at position 1 (dep B) should not cause rows
  # to be skipped from a move-in at position 0 (dep A), even when both positions
  # reference the same column and thus produce identical hashes.
  defp filter_moved_out_tags_for_dependency(state, name) do
    all_tags = state.move_handling_state.moved_out_tags[name] || %{}

    if DnfContext.has_valid_dnf?(state.dnf_context) do
      case Map.get(state.move_handling_state.waiting_move_ins, name) do
        {_snapshot, {["$sublink", index_str], _values}} ->
          dep_index = String.to_integer(index_str)

          dep_positions =
            SubqueryMoves.find_dnf_positions_for_dep_index(
              state.dnf_context.decomposition,
              dep_index
            )

          case dep_positions do
            [] ->
              all_tags

            positions ->
              dep_positions_set = MapSet.new(positions)
              Map.filter(all_tags, fn {pos, _} -> MapSet.member?(dep_positions_set, pos) end)
          end

        _ ->
          all_tags
      end
    else
      all_tags
    end
  end

  # Returns true when we have a valid DNF context but this specific dependency
  # has no positions in it. This happens for nested subquery dependencies that
  # are extracted by the parser but are only indirectly relevant (handled by the
  # dependency chain, not by the consumer directly).
  defp dep_has_no_dnf_positions?(nil, _dep_handle), do: false

  defp dep_has_no_dnf_positions?(dnf_context, dep_handle) do
    DnfContext.has_valid_dnf?(dnf_context) and
      DnfContext.get_positions_for_dependency(dnf_context, dep_handle) == []
  end

  # Split DNF positions for a dependency into positive and negated.
  # Returns nil if no DNF context or no positions for this dependency.
  defp get_negation_split(nil, _dep_handle), do: nil

  defp get_negation_split(dnf_context, dep_handle) do
    if DnfContext.has_valid_dnf?(dnf_context) do
      positions = DnfContext.get_positions_for_dependency(dnf_context, dep_handle)

      if positions == [] do
        nil
      else
        negated = Enum.filter(positions, &DnfContext.position_negated?(dnf_context, &1))
        positive = positions -- negated
        {positive, negated}
      end
    else
      nil
    end
  end

  # Start an async move-in query for new values.
  defp do_start_move_in_query(state, dep_handle, values, opts \\ []) do
    formed_where_clause =
      SubqueryMoves.move_in_where_clause(
        state.shape,
        dep_handle,
        Enum.map(values, &elem(&1, 1)),
        state.dnf_context,
        opts
      )

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
        {["$sublink", Integer.to_string(index)], MapSet.new(Enum.map(values, &elem(&1, 0)))}
      )

    Logger.debug("Move-in #{name} has been triggered from #{dep_handle}")

    %{state | move_handling_state: move_handling_state}
  end

  # Broadcast a deactivation (move-out) control message.
  defp do_broadcast_deactivation(state, dep_handle, values) do
    message =
      SubqueryMoves.make_move_out_control_message(
        state.shape,
        state.stack_id,
        state.shape_handle,
        [
          {dep_handle, values}
        ],
        state.dnf_context
      )

    # Pass position-aware patterns to move_out_happened
    move_handling_state =
      MoveIns.move_out_happened(
        state.move_handling_state,
        message.headers.patterns
      )

    {{_, upper_bound}, writer} = Storage.append_control_message!(message, state.writer)

    {%{state | move_handling_state: move_handling_state, writer: writer},
     {[message], upper_bound}}
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
