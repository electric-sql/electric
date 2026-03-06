defmodule Electric.Shapes.Consumer.ChangeHandling do
  alias Electric.Shapes.Consumer.MoveIns
  alias Electric.Replication.Eval.Runner
  alias Electric.Shapes.Shape
  alias Electric.Shapes.WhereClause
  alias Electric.Replication.LogOffset
  alias Electric.LogItems
  alias Electric.Shapes.Consumer.State
  alias Electric.Shapes.Consumer
  alias Electric.Replication.Changes

  require Electric.Shapes.Shape

  @spec process_changes(list(Changes.change()), State.t(), context) ::
          {filtered_changes :: list(Changes.change()), state :: State.t(),
           count :: non_neg_integer(), last_log_offset :: LogOffset.t() | nil}
          | :includes_truncate
        when context: map()
  def process_changes(changes, state, ctx)
      when is_map_key(ctx, :xid) do
    do_process_changes(changes, state, ctx, [], 0)
  end

  def do_process_changes(changes, state, ctx, acc, count)

  def do_process_changes([], state, _, _, 0), do: {[], state, 0, nil}

  def do_process_changes([], state, _, [head | tail], total_ops),
    do:
      {Enum.reverse([%{head | last?: true} | tail]), state, total_ops,
       LogItems.expected_offset_after_split(head)}

  def do_process_changes([%Changes.TruncatedRelation{} | _], _, _, _, _), do: :includes_truncate

  # We're special casing processing without dependencies, as it's very common so we can optimize it.
  def do_process_changes([change | rest], %State{shape: shape} = state, ctx, acc, count)
      when not Shape.has_dependencies(shape) do
    case Shape.convert_change(shape, change,
           stack_id: state.stack_id,
           shape_handle: state.shape_handle,
           extra_refs: ctx.extra_refs
         ) do
      [] ->
        do_process_changes(rest, state, ctx, acc, count)

      [change] ->
        state = State.track_change(state, ctx.xid, change)
        do_process_changes(rest, state, ctx, [change | acc], count + 1)
    end
  end

  def do_process_changes(
        [change | rest],
        %State{shape: shape, stack_id: stack_id, shape_handle: shape_handle} = state,
        ctx,
        acc,
        count
      ) do
    case decide_action_for_change(change, state, ctx) do
      {false, false} ->
        do_process_changes(rest, state, ctx, acc, count)

      {false, true} ->
        state = shadow_key(state, ctx.xid, change)
        do_process_changes(rest, state, ctx, acc, count)

      {true, shadow?} ->
        case Shape.convert_change(shape, change,
               stack_id: stack_id,
               shape_handle: shape_handle,
               extra_refs: ctx.extra_refs
             ) do
          [] ->
            state = if shadow?, do: shadow_key(state, ctx.xid, change), else: state
            do_process_changes(rest, state, ctx, acc, count)

          [converted] ->
            state = State.track_change(state, ctx.xid, converted)
            state = if shadow?, do: shadow_key(state, ctx.xid, change), else: state
            do_process_changes(rest, state, ctx, [converted | acc], count + 1)
        end
    end
  end

  # Returns {emit :: boolean(), shadow :: boolean()} telling the caller whether to
  # write the WAL change to the log and whether to record the key in touch_tracker
  # so that move-in results skip this key.
  @spec decide_action_for_change(Changes.change(), State.t(), map()) ::
          {boolean(), boolean()}

  # 1. Already visible in RESOLVED (filtering) move-ins → skip entirely
  defp decide_action_for_change(change, state, ctx) do
    if Consumer.MoveIns.change_already_visible?(state.move_handling_state, ctx.xid, change) do
      {false, false}
    else
      decide_action_for_change_inner(change, state, ctx)
    end
  end

  # 2. DELETE: always emit, shadow if old sublink value is in any waiting move-in
  defp decide_action_for_change_inner(%Changes.DeletedRecord{} = change, state, _ctx) do
    old_in_mi? = old_value_in_pending_move_in?(change, state)
    {true, old_in_mi?}
  end

  # 3/4. INSERT or UPDATE
  defp decide_action_for_change_inner(change, state, ctx) do
    referenced_values = get_referenced_values(change, state)
    new_in_mi? = change_visible_in_unresolved_move_ins_for_values?(referenced_values, state, ctx)

    sublink_changed? =
      is_struct(change, Changes.UpdatedRecord) and sublink_value_changed?(change, state)

    if sublink_changed? do
      # Case 4: UPDATE with sublink change
      old_in_mi? = old_value_in_pending_move_in?(change, state)

      if new_in_mi? do
        # New value is in a pending move-in — can we skip?
        if change_covered_by_known_snapshot?(referenced_values, state, ctx) and
             where_clause_matches?(change, state, ctx) do
          {false, old_in_mi?}
        else
          {true, old_in_mi?}
        end
      else
        # New value NOT in any pending move-in
        {true, old_in_mi?}
      end
    else
      # Case 3: INSERT or UPDATE without sublink change
      if new_in_mi? and where_clause_matches?(change, state, ctx) do
        {false, false}
      else
        {true, false}
      end
    end
  end

  defp where_clause_matches?(change, state, %{extra_refs: {_old, extra_refs_new}}) do
    # The move-in query uses the full WHERE clause. If the record doesn't match
    # non-subquery conditions, the move-in won't return this row.
    WhereClause.includes_record?(state.shape.where, change.record, extra_refs_new)
  end

  defp where_clause_matches?(_change, _state, _ctx) do
    # If extra_refs is not a tuple (e.g., empty map in tests), fall back to
    # the old behavior of skipping the change
    true
  end

  defp sublink_value_changed?(
         %Changes.UpdatedRecord{record: new_record, old_record: old_record},
         state
       ) do
    Enum.any?(state.shape.subquery_comparison_expressions, fn {_path, expr} ->
      {:ok, new_value} = Runner.execute_for_record(expr, new_record)
      {:ok, old_value} = Runner.execute_for_record(expr, old_record)
      new_value != old_value
    end)
  end

  defp get_referenced_values(change, state) do
    state.shape.subquery_comparison_expressions
    |> Map.new(fn {path, expr} ->
      {:ok, value} = Runner.execute_for_record(expr, change.record)
      {path, value}
    end)
  end

  defp get_referenced_values_from_old(%{old_record: old_record}, state) do
    state.shape.subquery_comparison_expressions
    |> Map.new(fn {path, expr} ->
      {:ok, value} = Runner.execute_for_record(expr, old_record)
      {path, value}
    end)
  end

  defp old_value_in_pending_move_in?(change, state) do
    old_values = get_referenced_values_from_old(change, state)
    MoveIns.values_in_any_pending_move_in?(state.move_handling_state, old_values)
  end

  defp shadow_key(%State{move_handling_state: move_handling_state} = state, xid, %{key: key}) do
    %{
      state
      | move_handling_state: %{
          move_handling_state
          | touch_tracker: Map.put(move_handling_state.touch_tracker, key, xid)
        }
    }
  end

  defp change_visible_in_unresolved_move_ins_for_values?(referenced_values, state, ctx) do
    MoveIns.change_visible_in_unresolved_move_ins_for_values?(
      state.move_handling_state,
      referenced_values,
      ctx.xid
    )
  end

  defp change_covered_by_known_snapshot?(referenced_values, state, ctx) do
    MoveIns.change_covered_by_known_snapshot?(
      state.move_handling_state,
      referenced_values,
      ctx.xid
    )
  end
end
