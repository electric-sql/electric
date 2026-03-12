defmodule Electric.Shapes.Consumer.ChangeHandling do
  import Record

  alias Electric.Replication.LogOffset
  alias Electric.Shapes.Consumer.MoveIns
  alias Electric.LogItems
  alias Electric.Shapes.Shape
  alias Electric.Shapes.WhereClause
  alias Electric.Shapes.Consumer.State
  alias Electric.Replication.Changes

  require Shape
  require State
  require Logger

  defrecord :change_info,
    kind: nil,
    key: nil,
    authority: :normal,
    old_in_stable?: false,
    new_in_stable?: false,
    old_in_full?: false,
    new_in_full?: false,
    old_owner: nil,
    new_owner: nil,
    old_owner_covers?: false,
    new_owner_covers?: false

  @type move_in_refs() :: list()
  @type emit_target() :: :insert | :update | :delete
  @type decision_reason() :: String.t()
  @type decision() ::
          {:skip, decision_reason()}
          | {:skip_and_shadow, shadow_move_ins :: move_in_refs(), decision_reason()}
          | {:skip_and_delegate, delegate_move_ins :: move_in_refs(), decision_reason()}
          | {:skip_and_shadow_and_delegate, shadow_move_ins :: move_in_refs(),
             delegate_move_ins :: move_in_refs(), decision_reason()}
          | {:emit, emit_target(), shadow_move_ins :: move_in_refs(), decision_reason()}

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
  # Also in the same special case is when there are no move-ins in flight.
  def do_process_changes([change | rest], %State{shape: shape} = state, ctx, acc, count)
      when not Shape.has_dependencies(shape)
      when not State.has_unresolved_move_ins(state) do
    simple_process_and_continue(change, rest, state, ctx, acc, count)
  end

  def do_process_changes([change | rest], %State{} = state, ctx, acc, count) do
    cond do
      MoveIns.shadowed_key?(state.move_handling_state, change.key) ->
        # [P.shadow] WAL is authoritative for shadowed keys — always emit,
        # never delegate to move-in. Use full refs so old value is correctly
        # recognized as in-shape (we already emitted it).
        {_, full_refs} = ctx.extra_refs
        shadow_ctx = %{ctx | extra_refs: {full_refs, full_refs}}

        # Update shadow with any newly-relevant MIs. As the row moves between
        # different MI values (e.g. parent_id 2→3), new MIs become relevant.
        # Without this, when the original shadowing MI resolves, its name is
        # removed and the shadow disappears — causing a duplicate INSERT from
        # the new MI's splice.
        state =
          case relevant_waiting_move_ins(state, change) do
            [] -> state
            relevant_move_ins -> shadow_key(state, ctx.xid, change.key, relevant_move_ins)
          end

        case simple_process_change(change, state, shadow_ctx) do
          nil ->
            do_process_changes(rest, state, ctx, acc, count)

          converted ->
            state = maybe_update_shadow_tags(state, change.key, converted)
            state = maybe_drop_shadow_after_emit(state, change.key, converted)
            state = maybe_release_delegation_after_emit(state, converted)
            do_process_changes(rest, state, ctx, [converted | acc], count + 1)
        end

      MoveIns.change_already_visible?(state.move_handling_state, ctx.xid, change) ->
        do_process_changes(rest, state, ctx, acc, count)

      not State.has_move_ins_in_flight(state) ->
        # When no move-ins are in flight, there is no complexity
        simple_process_and_continue(change, rest, state, ctx, acc, count)

      true ->
        case relevant_waiting_move_ins(state, change) do
          [] ->
            simple_process_and_continue(change, rest, state, ctx, acc, count)

          relevant_move_ins ->
            info = collect_change_info(change, state, ctx, relevant_move_ins)

            {change, state} =
              info
              |> decide_change()
              |> apply_decision(change, state, ctx, info)

            case change do
              nil ->
                do_process_changes(rest, state, ctx, acc, count)

              converted ->
                state = maybe_release_delegation_after_emit(state, converted)
                do_process_changes(rest, state, ctx, [converted | acc], count + 1)
            end
        end
    end
  end

  defp simple_process_and_continue(change, rest, state, ctx, acc, count) do
    case simple_process_change(change, state, ctx) do
      nil ->
        do_process_changes(rest, state, ctx, acc, count)

      converted ->
        state = maybe_release_delegation_after_emit(state, converted)
        do_process_changes(rest, state, ctx, [converted | acc], count + 1)
    end
  end

  defp simple_process_change(change, state, ctx) do
    info = collect_simple_change_info(change, state, ctx)

    case build_emitted_change(change, state, expected_emit_type(info)) do
      nil ->
        nil

      converted ->
        converted
    end
  end

  def relevant_waiting_move_ins(
        %State{} = state,
        change
      ) do
    MoveIns.relevant_waiting_move_ins(state.move_handling_state, state.shape, change)
  end

  defp shadow_key(state, xid, key, relevant_move_ins),
    do: shadow_key(state, xid, key, relevant_move_ins, nil)

  defp shadow_key(
         %{move_handling_state: move_handling_state} = state,
         xid,
         key,
         relevant_move_ins,
         tags
       ) do
    %{
      state
      | move_handling_state:
          MoveIns.shadow_key(move_handling_state, xid, key, relevant_move_ins, tags)
    }
  end

  defp shadow_change(state, xid, %{key: key} = change, relevant_move_ins) do
    shadow_key(state, xid, key, relevant_move_ins, change_tags(state, change))
  end

  defp maybe_update_shadow_tags(
         %{move_handling_state: _move_handling_state} = state,
         _key,
         %Changes.DeletedRecord{}
       ) do
    state
  end

  defp maybe_update_shadow_tags(
         %{move_handling_state: move_handling_state} = state,
         key,
         change
       ) do
    %{
      state
      | move_handling_state:
          MoveIns.update_shadow_tags(move_handling_state, key, change_tags(state, change))
    }
  end

  defp maybe_drop_shadow_after_emit(
         %{move_handling_state: move_handling_state} = state,
         key,
         %Changes.DeletedRecord{}
       ) do
    %{state | move_handling_state: MoveIns.drop_shadow(move_handling_state, key)}
  end

  defp maybe_drop_shadow_after_emit(state, _key, _converted), do: state

  defp maybe_release_delegation_after_emit(
         %{move_handling_state: move_handling_state} = state,
         %{key: key}
       ) do
    %{state | move_handling_state: MoveIns.release_delegation(move_handling_state, key)}
  end

  defp delegate_change(state, xid, %{key: key} = change, relevant_move_ins) do
    %{
      state
      | move_handling_state:
          MoveIns.delegate_key(
            state.move_handling_state,
            xid,
            key,
            relevant_move_ins,
            change_tags(state, change)
          )
    }
  end

  defp change_tags(state, change) do
    change
    |> Shape.fill_move_tags(state.shape, state.stack_id, state.shape_handle)
    |> Map.get(:move_tags, [])
  end

  defp collect_simple_change_info(change, state, %{extra_refs: {stable_refs, full_refs}}) do
    old_record = old_record(change)
    new_record = new_record(change)

    change_info(
      kind: change_kind(change),
      key: change.key,
      old_in_stable?: record_matches?(change, state.shape, old_record, stable_refs),
      new_in_full?: record_matches?(change, state.shape, new_record, full_refs)
    )
  end

  defp collect_change_info(
         change,
         state,
         %{xid: xid, extra_refs: {stable_refs, full_refs}},
         relevant_move_ins
       ) do
    old_record = old_record(change)
    new_record = new_record(change)

    old_in_stable? = record_matches?(change, state.shape, old_record, stable_refs)
    new_in_stable? = record_matches?(change, state.shape, new_record, stable_refs)
    old_in_full? = record_matches?(change, state.shape, old_record, full_refs)
    new_in_full? = record_matches?(change, state.shape, new_record, full_refs)

    old_owner = owner_for_side(old_record, state.shape, relevant_move_ins)
    new_owner = owner_for_side(new_record, state.shape, relevant_move_ins)

    change_info(
      kind: change_kind(change),
      key: change.key,
      authority: authority_for_key(state, change.key),
      old_in_stable?: old_in_stable?,
      new_in_stable?: new_in_stable?,
      old_in_full?: old_in_full?,
      new_in_full?: new_in_full?,
      old_owner: old_owner,
      new_owner: new_owner,
      old_owner_covers?: MoveIns.move_in_covers_xid?(old_owner, xid),
      new_owner_covers?: MoveIns.move_in_covers_xid?(new_owner, xid)
    )
  end

  defp decide_change(info) do
    case change_info(info, :authority) do
      :shadowed ->
        case expected_emit_type_with_full_refs(info) do
          # [P.shadow] Once WAL has taken authority for a key, we never delegate
          # it back to a pending move-in. If the key is not visible even under
          # full refs, nothing should be emitted.
          :skip ->
            action_skip("not_in_shape")

          # [P.shadow] Otherwise emit the WAL effect and keep shadowing every
          # currently relevant move-in so their splice cannot re-insert the key.
          target ->
            action_emit_and_shadow(target, owner_union(info), "already_shadowed")
        end

      _ ->
        decide_change_by_kind(info)
    end
  end

  defp decide_change_by_kind(info) when change_info(info, :kind) == :insert do
    cond do
      not change_info(info, :new_in_full?) ->
        # The inserted row is outside the shape even after considering pending
        # refs, so neither WAL nor a move-in should materialize it.
        action_skip("not_in_shape")

      is_nil(change_info(info, :new_owner)) ->
        # No pending move-in owns the linked value, so WAL is the only source
        # that can introduce the row.
        action_emit(:insert, "emit")

      change_info(info, :new_owner_covers?) ->
        # [I.2] The upcoming move-in snapshot will see this insert and return
        # the row. Skip WAL and delegate authority to that move-in.
        action_skip_and_delegate(change_info(info, :new_owner), "some_covering_move_ins")

      true ->
        # [I.1] The move-in is relevant but does not cover the insert, so WAL
        # must emit now and shadow the move-in to suppress a stale query row.
        action_emit_and_shadow(
          :insert,
          change_info(info, :new_owner),
          "no_covering_move_ins"
        )
    end
  end

  defp decide_change_by_kind(info) when change_info(info, :kind) == :delete do
    cond do
      not change_info(info, :old_in_stable?) ->
        # The row was not visible in the stable log view before the delete, so
        # there is nothing to remove from the shape.
        action_skip("not_in_shape")

      is_nil(change_info(info, :old_owner)) ->
        # No pending move-in can still supply the old row, so emit the delete
        # in normal WAL order.
        action_emit(:delete, "emit")

      change_info(info, :old_owner_covers?) and change_info(info, :authority) == :delegated ->
        # [D.2a] The key was already delegated to a covering move-in. That
        # query sees the net effect (row absent), so both insert/update history
        # and this delete stay delegated and WAL skips the delete too.
        action_skip("delete_of_delegated_key")

      not change_info(info, :old_owner_covers?) ->
        # [D.1] The old row can still come back from the uncovered move-in, so
        # emit the delete and shadow that move-in to suppress the stale row.
        action_emit_and_shadow(
          :delete,
          change_info(info, :old_owner),
          "delete_not_covered"
        )

      true ->
        # [D.2b] A covering move-in will not return the row, but the key is
        # already present in WAL history rather than delegated, so we must emit
        # the delete to preserve per-key ordering.
        action_emit(:delete, "upcoming_move_in_covers_delete")
    end
  end

  defp decide_change_by_kind(info) when change_info(info, :kind) == :update do
    old_owner = change_info(info, :old_owner)
    new_owner = change_info(info, :new_owner)
    old_state = side_state(change_info(info, :old_in_stable?), old_owner)
    new_state = side_state(change_info(info, :new_in_stable?), new_owner)

    case {old_state, new_state} do
      {old, new} when old != :in_flight and new != :in_flight ->
        # No side is owned by a pending move-in, so this reduces to the plain
        # old-stable/new-full shape transition.
        decide_mixed_emit(info, "emit")

      {:not_in_any, :in_flight} ->
        # [Ub.1] The row enters the shape only through a pending move-in value.
        # Treat the update as an insert unless the move-in covers it.
        decide_force_insert_if_not_covered(
          info,
          new_owner,
          "no_covering_move_ins",
          "some_covering_move_ins"
        )

      {:in_stable, :in_flight} ->
        case expected_emit_type(info) do
          # [Ub.2] The row already exists in the log and remains visible after
          # moving onto an in-flight value, so emit the update and shadow the
          # new owner to prevent a duplicate insert from the move-in splice.
          :update ->
            action_emit_and_shadow(:update, new_owner, "in_shape_and_in_flight")

          # Defensive/generalized path: if broader WHERE logic turns this into a
          # fresh insert, delegate when covered and otherwise emit+shadow.
          :insert ->
            if change_info(info, :new_owner_covers?) do
              action_skip_and_delegate(new_owner, "covering_move_ins")
            else
              action_emit_and_shadow(:insert, new_owner, "not_covering_move_ins")
            end

          # The row was visible before but not after the update; emit the
          # delete ourselves and keep the move-in shadowed just in case.
          :delete ->
            action_emit_and_shadow(:delete, new_owner, "in_shape_and_in_flight")

          # Defensive/generalized path: the row is outside the shape both
          # before and after once full WHERE evaluation is applied.
          :skip ->
            action_skip("not_in_shape")
        end

      {:in_flight, :in_stable} ->
        case expected_emit_type_for_new_only(info) do
          # Defensive/generalized path: the new row is still not visible, so
          # neither WAL nor the move-in should materialize anything.
          :skip ->
            action_skip("not_in_shape")

          # [Ub.3] The old version belonged only to a pending move-in, but the
          # new version is stably in shape. Emit the new version (typically as
          # an insert) and shadow the old owner only if its query will not
          # already see the change.
          target ->
            shadow_move_ins =
              if change_info(info, :old_owner_covers?), do: nil, else: old_owner

            action_emit_with_optional_shadow(
              target,
              shadow_move_ins,
              "old_in_flight_new_in_shape"
            )
        end

      {:in_flight, :not_in_any} ->
        if change_info(info, :old_owner_covers?) do
          # [Ub.4b] The pending move-in snapshot already sees the row gone, so
          # WAL can skip this transition entirely.
          action_skip("move_out_already_covered")
        else
          # [Ub.4a] The move-in may still return the old row even though the
          # new row is out of shape, so shadow it and emit nothing.
          action_skip_and_shadow(old_owner, "old_in_flight_new_not_in_any")
        end

      {:in_flight, :in_flight} when old_owner == new_owner ->
        # [Ub.5] The row stays within the same pending move-in's ownership.
        # This again reduces to "emit as insert unless that move-in covers it."
        decide_force_insert_if_not_covered(
          info,
          old_owner,
          "no_covering_move_ins",
          "some_covering_move_ins"
        )

      {:in_flight, :in_flight} ->
        # [Ub.6] The row migrates from one pending move-in to another. Coverage
        # on both sides determines whether WAL must step in or one move-in can
        # remain authoritative.
        decide_cross_move_in_update(info)
    end
  end

  defp decide_cross_move_in_update(info) do
    old_owner = change_info(info, :old_owner)
    new_owner = change_info(info, :new_owner)
    old_covers = change_info(info, :old_owner_covers?)
    new_covers = change_info(info, :new_owner_covers?)

    case {old_covers, new_covers} do
      {true, true} ->
        if expected_emit_type_for_new_only(info) == :insert do
          # [Ub.6a] Both move-ins see the update, and the new-side move-in is
          # the one that can re-materialize the visible row. Delegate to it.
          action_skip_and_delegate(new_owner, "both_move_ins_cover")
        else
          # [Ub.6a] Both move-ins cover the transition and the resulting row is
          # not visible, so neither WAL nor move-ins should emit it.
          action_skip("both_move_ins_cover")
        end

      {false, false} ->
        case expected_emit_type_for_new_only(info) do
          # [Ub.6b] Neither move-in covers the update, so WAL must emit the new
          # visible row now and shadow both pending move-ins.
          :insert ->
            action_emit_and_shadow(:insert, owner_union(info), "neither_mi_covers")

          # The row ends up outside the shape, but the old move-in can still
          # return its stale version. Shadow only that old owner.
          :skip ->
            action_skip_and_shadow(old_owner, "not_in_shape")
        end

      {false, true} ->
        if expected_emit_type_for_new_only(info) == :insert do
          # [Ub.6c] The new-side move-in covers and will supply the new row, but
          # the old-side move-in can still return stale pre-update data. Shadow
          # the old side and delegate the new side.
          action_skip_and_shadow_and_delegate(
            old_owner,
            new_owner,
            "move_in_for_new_value_will_have_new_value"
          )
        else
          # The new-side move-in covers that the row is absent; only the old
          # side needs shadowing to suppress a stale query result.
          action_skip_and_shadow(
            old_owner,
            "move_in_for_new_value_will_have_new_value"
          )
        end

      {true, false} ->
        case expected_emit_type_for_new_only(info) do
          # [Ub.6d] The old move-in covers, the new one does not, and neither
          # query will produce the visible new row. WAL must emit it and shadow
          # both move-ins.
          :insert ->
            action_emit_and_shadow(:insert, owner_union(info), "old_mi_covers_new_doesnt")

          # The row is not visible after the update and the covering old-side
          # move-in already sees that disappearance.
          :skip ->
            action_skip("not_in_shape")
        end
    end
  end

  defp decide_force_insert_if_not_covered(info, owner, not_covered_reason, covered_reason) do
    if change_covered?(info, owner) do
      if expected_emit_type_for_new_only(info) == :insert do
        # The owner move-in covers this change and can provide the row as a
        # fresh insert, so WAL skips and delegates to that move-in.
        action_skip_and_delegate(owner, covered_reason)
      else
        # The owner move-in covers the change and the row is not visible after
        # it, so WAL has nothing to contribute.
        action_skip(covered_reason)
      end
    else
      case expected_emit_type_for_new_only(info) do
        # The owner does not cover the change, but the row is still out of
        # shape afterwards, so neither source should emit it.
        :skip ->
          action_skip("not_in_shape")

        # The owner does not cover the change and the row becomes visible, so
        # WAL must emit it now and shadow the move-in's future splice.
        target ->
          action_emit_and_shadow(target, owner, not_covered_reason)
      end
    end
  end

  defp decide_mixed_emit(info, reason) do
    case expected_emit_type(info) do
      # Plain WHERE evaluation says the row is not visible in the shape.
      :skip ->
        action_skip("not_in_shape")

      # No move-in arbitration is needed; emit the ordinary shape transition.
      target ->
        action_emit(target, reason)
    end
  end

  defp action_skip(reason), do: {:skip, reason}

  defp action_skip_and_shadow(shadow_move_ins, reason),
    do: {:skip_and_shadow, List.wrap(shadow_move_ins), reason}

  defp action_skip_and_delegate(delegate_move_ins, reason),
    do: {:skip_and_delegate, List.wrap(delegate_move_ins), reason}

  defp action_skip_and_shadow_and_delegate(
         shadow_move_ins,
         delegate_move_ins,
         reason
       ),
       do:
         {:skip_and_shadow_and_delegate, List.wrap(shadow_move_ins), List.wrap(delegate_move_ins),
          reason}

  # `:emit` decisions always carry the move-ins to shadow in tuple position 3.
  # Using constructors keeps that intent explicit at the call site.
  defp action_emit(target, reason), do: {:emit, target, [], reason}

  defp action_emit_and_shadow(target, shadow_move_ins, reason),
    do: {:emit, target, List.wrap(shadow_move_ins), reason}

  defp action_emit_with_optional_shadow(target, shadow_move_ins, reason)
       when shadow_move_ins in [nil, []],
       do: action_emit(target, reason)

  defp action_emit_with_optional_shadow(target, shadow_move_ins, reason),
    do: action_emit_and_shadow(target, shadow_move_ins, reason)

  defp apply_decision(decision, change, state, ctx, _info) do
    converted =
      case decision do
        {:emit, target, _shadow_move_ins, _reason} -> build_emitted_change(change, state, target)
        _ -> nil
      end

    case {decision, converted} do
      {{:skip, _reason}, _converted} ->
        {nil, state}

      {{:skip_and_shadow, move_ins, _reason}, _converted} ->
        {nil, shadow_key(state, ctx.xid, change.key, move_ins)}

      {{:skip_and_delegate, move_ins, _reason}, _converted} ->
        {nil, delegate_change(state, ctx.xid, change, move_ins)}

      {{:skip_and_shadow_and_delegate, shadow_move_ins, delegate_move_ins, _reason}, _converted} ->
        state =
          state
          |> shadow_key(ctx.xid, change.key, shadow_move_ins)
          |> delegate_change(ctx.xid, change, delegate_move_ins)

        {nil, state}

      {{:emit, _target, _shadow_move_ins, _reason}, nil} ->
        {nil, state}

      {{:emit, _target, [], _reason}, converted} ->
        {converted, state}

      {{:emit, _target, shadow_move_ins, _reason}, converted} ->
        {converted, shadow_change(state, ctx.xid, converted, shadow_move_ins)}
    end
  end

  defp owner_for_side(nil, _shape, _relevant_move_ins), do: nil

  defp owner_for_side(record, shape, relevant_move_ins) do
    MoveIns.owner_for_record(shape, record, relevant_move_ins)
  end

  defp change_covered?(info, owner) when owner == change_info(info, :old_owner),
    do: change_info(info, :old_owner_covers?)

  defp change_covered?(info, owner) when owner == change_info(info, :new_owner),
    do: change_info(info, :new_owner_covers?)

  defp change_covered?(_info, _owner), do: false

  defp authority_for_key(%{move_handling_state: move_handling_state}, key),
    do: MoveIns.authority_for_key(move_handling_state, key)

  defp side_state(true, _owner), do: :in_stable
  defp side_state(false, nil), do: :not_in_any
  defp side_state(false, _owner), do: :in_flight

  defp expected_emit_type(info) do
    target_kind(
      change_info(info, :kind),
      change_info(info, :old_in_stable?),
      change_info(info, :new_in_full?)
    )
  end

  defp expected_emit_type_with_full_refs(info) do
    target_kind(
      change_info(info, :kind),
      change_info(info, :old_in_full?),
      change_info(info, :new_in_full?)
    )
  end

  defp expected_emit_type_for_new_only(info) do
    target_kind(change_info(info, :kind), false, change_info(info, :new_in_full?))
  end

  defp target_kind(:insert, _old_visible, true), do: :insert
  defp target_kind(:insert, _old_visible, false), do: :skip
  defp target_kind(:delete, true, _new_visible), do: :delete
  defp target_kind(:delete, false, _new_visible), do: :skip
  defp target_kind(:update, true, true), do: :update
  defp target_kind(:update, true, false), do: :delete
  defp target_kind(:update, false, true), do: :insert
  defp target_kind(:update, false, false), do: :skip

  defp build_emitted_change(_change, _state, :skip), do: nil

  defp build_emitted_change(change, state, target_kind) do
    change
    |> build_base_change(target_kind)
    |> finalize_emitted_change(state)
  end

  defp build_base_change(%Changes.NewRecord{} = change, :insert), do: change
  defp build_base_change(%Changes.DeletedRecord{} = change, :delete), do: change
  defp build_base_change(%Changes.UpdatedRecord{} = change, :update), do: change

  defp build_base_change(%Changes.UpdatedRecord{} = change, :insert),
    do: Changes.convert_update(change, to: :new_record)

  defp build_base_change(%Changes.UpdatedRecord{} = change, :delete),
    do: Changes.convert_update(change, to: :deleted_record)

  defp build_base_change(_change, _target_kind), do: nil

  defp finalize_emitted_change(nil, _state), do: nil

  defp finalize_emitted_change(change, state) do
    change
    |> Shape.fill_move_tags(state.shape, state.stack_id, state.shape_handle)
    |> Changes.filter_columns(state.shape.selected_columns)
    |> then(fn filtered -> if keep_change?(filtered), do: filtered, else: nil end)
  end

  defp keep_change?(%Changes.UpdatedRecord{removed_move_tags: removed_move_tags})
       when removed_move_tags != [],
       do: true

  defp keep_change?(%Changes.UpdatedRecord{old_record: record, record: record}), do: false
  defp keep_change?(_), do: true

  defp record_matches?(_change, _shape, nil, _refs), do: false

  defp record_matches?(%{relation: relation}, %Shape{root_table: table}, _record, _refs)
       when relation != table,
       do: false

  defp record_matches?(_change, %Shape{where: nil}, _record, _refs), do: true

  defp record_matches?(_change, %Shape{where: where}, record, refs) do
    WhereClause.includes_record?(where, record, refs)
  rescue
    KeyError -> false
  end

  defp change_kind(%Changes.NewRecord{}), do: :insert
  defp change_kind(%Changes.DeletedRecord{}), do: :delete
  defp change_kind(%Changes.UpdatedRecord{}), do: :update

  defp old_record(%Changes.NewRecord{}), do: nil
  defp old_record(%Changes.DeletedRecord{old_record: old_record}), do: old_record
  defp old_record(%Changes.UpdatedRecord{old_record: old_record}), do: old_record

  defp new_record(%Changes.NewRecord{record: record}), do: record
  defp new_record(%Changes.DeletedRecord{}), do: nil
  defp new_record(%Changes.UpdatedRecord{record: record}), do: record

  defp owner_union(info) do
    [change_info(info, :old_owner), change_info(info, :new_owner)]
    |> Enum.reject(&is_nil/1)
    |> Enum.uniq()
  end
end
