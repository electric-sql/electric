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
    if not change_visible_in_resolved_move_ins?(change, state, ctx) and
         not change_will_be_covered_by_move_in?(change, state, ctx) do
      case Shape.convert_change(shape, change,
             stack_id: stack_id,
             shape_handle: shape_handle,
             extra_refs: ctx.extra_refs,
             dnf_context: state.dnf_context
           ) do
        [] ->
          do_process_changes(rest, state, ctx, acc, count)

        [change] ->
          state = State.track_change(state, ctx.xid, change)
          do_process_changes(rest, state, ctx, [change | acc], count + 1)
      end
    else
      do_process_changes(rest, state, ctx, acc, count)
    end
  end

  defp change_visible_in_resolved_move_ins?(change, state, ctx) do
    Consumer.MoveIns.change_already_visible?(state.move_handling_state, ctx.xid, change)
  end

  defp change_will_be_covered_by_move_in?(%Changes.DeletedRecord{}, _, _), do: false

  defp change_will_be_covered_by_move_in?(change, state, ctx) do
    # First check if the new record's sublink values are in pending move-ins
    referenced_values = get_referenced_values(change, state)

    if change_visible_in_unresolved_move_ins_for_values?(referenced_values, state, ctx) do
      # For UpdatedRecords where the sublink value changed, we must NOT skip the change.
      # The move-in query will return this row as an INSERT, which doesn't carry
      # removed_move_tags. Without the tag transition from the WAL change, the client
      # will retain the old tag, causing the row to not be properly cleaned up on
      # subsequent move-outs.
      if is_struct(change, Changes.UpdatedRecord) and
           sublink_value_changed?(change, state) do
        false
      else
        # Even if the sublink value is in a pending move-in, we should only skip
        # this change if the new record actually matches the full WHERE clause.
        # The move-in query uses the full WHERE clause, so if the record doesn't
        # match other non-subquery conditions in the WHERE clause, the move-in
        # won't return this row and we need to process this change normally.
        case ctx.extra_refs do
          {_extra_refs_old, extra_refs_new} ->
            WhereClause.includes_record?(state.shape.where, change.record, extra_refs_new)

          _ ->
            # If extra_refs is not a tuple (e.g., empty map in tests), fall back to
            # the old behavior of skipping the change
            true
        end
      end
    else
      false
    end
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

  defp change_visible_in_unresolved_move_ins_for_values?(referenced_values, state, ctx) do
    MoveIns.change_visible_in_unresolved_move_ins_for_values?(
      state.move_handling_state,
      referenced_values,
      ctx.xid
    )
  end
end
