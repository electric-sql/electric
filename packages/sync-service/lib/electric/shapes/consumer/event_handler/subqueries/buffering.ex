defmodule Electric.Shapes.Consumer.EventHandler.Subqueries.Buffering do
  # Handles events while a move-in is buffered and waiting to be spliced.

  @behaviour Electric.Shapes.Consumer.EventHandler

  alias Electric.Postgres.Lsn
  alias Electric.Replication.Changes.Transaction
  alias Electric.Shapes.Consumer.EffectList
  alias Electric.Shapes.Consumer.Effects
  alias Electric.Shapes.Consumer.EventHandler.Subqueries.Steady
  alias Electric.Shapes.Consumer.Subqueries.ActiveMove
  alias Electric.Shapes.Consumer.Subqueries.IndexChanges
  alias Electric.Shapes.Consumer.Subqueries.MoveQueue
  alias Electric.Shapes.Consumer.Subqueries.RefResolver
  alias Electric.Shapes.Consumer.Subqueries.ShapeInfo
  alias Electric.Shapes.Consumer.Subqueries.SplicePlan
  alias Electric.Shapes.Filter.Indexes.SubqueryIndex
  alias Electric.Shapes.Filter.Indexes.SubqueryIndex.MultiTimeView
  alias Electric.Shapes.Filter.Indexes.SubqueryIndex.ProgressMonitor

  @enforce_keys [:shape_info, :queue, :active_move, :subquery_refs]
  defstruct [:shape_info, :queue, :active_move, :subquery_refs]

  @type t() :: %__MODULE__{
          shape_info: ShapeInfo.t(),
          queue: MoveQueue.t(),
          active_move: ActiveMove.t(),
          subquery_refs: Steady.subquery_refs()
        }

  @spec start(
          ShapeInfo.t(),
          Steady.subquery_refs(),
          MoveQueue.t(),
          IndexChanges.move(),
          [String.t()],
          from_time :: non_neg_integer(),
          to_time :: non_neg_integer(),
          keyword()
        ) :: {:ok, t(), [Effects.t()]}
  def start(
        %ShapeInfo{} = shape_info,
        subquery_refs,
        %MoveQueue{} = queue,
        {dep_move_kind, dep_index, values, txids},
        subquery_ref,
        from_time,
        to_time,
        opts \\ []
      ) do
    %{subquery_id: subquery_id} = Map.fetch!(subquery_refs, subquery_ref)

    state = %__MODULE__{
      shape_info: shape_info,
      queue: queue,
      subquery_refs: subquery_refs,
      active_move:
        ActiveMove.start(
          subquery_id,
          dep_index,
          dep_move_kind,
          subquery_ref,
          values,
          from_time,
          to_time,
          txids
        )
        |> ActiveMove.carry_latest_seen_lsn(Keyword.get(opts, :latest_seen_lsn))
    }

    move = {dep_move_kind, dep_index, values, txids}

    effects =
      EffectList.new()
      |> maybe_subscribe_global_lsn(Keyword.get(opts, :subscribe_global_lsn?, true))
      |> EffectList.append_all(
        IndexChanges.effects_for_buffering(state.shape_info.dnf_plan, move, subquery_ref)
      )
      |> EffectList.append(start_move_in_query_effect(state))
      |> EffectList.to_list()

    {:ok, state, effects}
  end

  @impl true
  def handle_event(%__MODULE__{} = state, %Transaction{} = txn) do
    next_active_move = ActiveMove.buffer_txn(state.active_move, txn)

    if ActiveMove.buffered_txn_count(next_active_move) > state.shape_info.buffer_max_transactions do
      {:error, :buffer_overflow}
    else
      state
      |> Map.put(:active_move, next_active_move)
      |> maybe_splice()
    end
  end

  def handle_event(%__MODULE__{} = state, {:global_last_seen_lsn, lsn}) do
    next_active_move = ActiveMove.record_seen_lsn(state.active_move, Lsn.from_integer(lsn))

    state
    |> Map.put(:active_move, next_active_move)
    |> maybe_splice()
  end

  def handle_event(%__MODULE__{} = state, {:materializer_changes, dep_handle, payload}) do
    subquery_ref = RefResolver.ref_from_dep_handle!(state.shape_info.ref_resolver, dep_handle)
    dep_index = subquery_ref |> List.last() |> String.to_integer()
    mtv = MultiTimeView.for_stack(state.shape_info.stack_id)
    dep_view = view_after_active_move(mtv, state.active_move, state.subquery_refs, subquery_ref)

    {:ok, %{state | queue: MoveQueue.enqueue(state.queue, dep_index, payload, dep_view)}, []}
  end

  def handle_event(%__MODULE__{} = state, {:pg_snapshot_known, snapshot}) do
    state
    |> Map.put(:active_move, ActiveMove.record_snapshot!(state.active_move, snapshot))
    |> maybe_splice()
  end

  def handle_event(
        %__MODULE__{} = state,
        {:query_move_in_complete, snapshot_name, row_count, row_bytes, move_in_lsn}
      ) do
    state
    |> Map.put(
      :active_move,
      ActiveMove.record_query_complete!(
        state.active_move,
        snapshot_name,
        row_count,
        row_bytes,
        move_in_lsn
      )
    )
    |> maybe_splice()
  end

  defp maybe_splice(%__MODULE__{active_move: active_move} = state) do
    if ActiveMove.ready_to_splice?(active_move) do
      splice(state)
    else
      {:ok, state, []}
    end
  end

  defp splice(%{active_move: active_move} = state) do
    with {:ok, splice_plan} <-
           SplicePlan.build(active_move, state.shape_info, state.subquery_refs) do
      index_effects =
        IndexChanges.effects_for_complete(
          state.shape_info.dnf_plan,
          {active_move.dep_move_kind, active_move.dep_index, active_move.values,
           active_move.txids},
          active_move.subquery_ref
        )

      advance_consumer_to_after_move(state, active_move)

      next_subquery_refs =
        Steady.advance_subquery_time(
          state.subquery_refs,
          active_move.subquery_ref,
          active_move.to_time
        )

      steady_state = %Steady{
        shape_info: state.shape_info,
        subquery_refs: next_subquery_refs,
        queue: state.queue
      }

      effects =
        splice_plan.effects
        |> EffectList.new()
        |> EffectList.append_all(index_effects)

      case Steady.drain_queue(
             steady_state,
             effects,
             subscription_active?: true,
             latest_seen_lsn: active_move.latest_seen_lsn
           ) do
        {:ok, %Steady{} = next_state, effects} ->
          effects =
            effects
            |> maybe_notify_flushed(splice_plan.flushed_log_offset)
            |> EffectList.append(%Effects.UnsubscribeGlobalLsn{})

          {:ok, next_state, EffectList.to_list(effects)}

        {:ok, %__MODULE__{} = next_state, effects} ->
          effects =
            effects
            |> maybe_notify_flushed(splice_plan.flushed_log_offset)

          {:ok, next_state, EffectList.to_list(effects)}
      end
    end
  end

  defp start_move_in_query_effect(%__MODULE__{shape_info: shape_info, active_move: active_move}) do
    %Effects.StartMoveInQuery{
      dnf_plan: shape_info.dnf_plan,
      trigger_dep_index: active_move.dep_index,
      values: active_move.values,
      subquery_id: active_move.subquery_id,
      subquery_ref: active_move.subquery_ref,
      from_time: active_move.from_time,
      to_time: active_move.to_time
    }
  end

  defp advance_consumer_to_after_move(%__MODULE__{shape_info: shape_info}, active_move) do
    case SubqueryIndex.for_stack(shape_info.stack_id) do
      nil ->
        :ok

      index ->
        SubqueryIndex.set_shape_subquery(
          index,
          shape_info.shape_handle,
          active_move.subquery_ref,
          active_move.subquery_id,
          active_move.to_time
        )

        ProgressMonitor.notify_processed_up_to(
          shape_info.stack_id,
          active_move.from_time,
          active_move.subquery_id,
          shape_info.shape_handle
        )
    end
  end

  defp maybe_subscribe_global_lsn(effects, true) do
    EffectList.append(effects, %Effects.SubscribeGlobalLsn{})
  end

  defp maybe_subscribe_global_lsn(effects, false), do: effects

  defp maybe_notify_flushed(effects, nil), do: effects

  defp maybe_notify_flushed(effects, log_offset) do
    EffectList.append(effects, %Effects.NotifyFlushed{log_offset: log_offset})
  end

  # The base view for reducing buffered move queue entries is the consumer's
  # view *as if* the in-flight active move had already spliced. For the
  # trigger ref that means MTV at `active_move.to_time`; for every other ref
  # the consumer is still pinned at its currently-tracked time.
  defp view_after_active_move(mtv, active_move, subquery_refs, subquery_ref) do
    %{subquery_id: subquery_id} = Map.fetch!(subquery_refs, subquery_ref)

    time =
      if subquery_ref == active_move.subquery_ref do
        active_move.to_time
      else
        subquery_refs[subquery_ref].time
      end

    mtv |> MultiTimeView.values(subquery_id, time) |> MapSet.new()
  end
end
