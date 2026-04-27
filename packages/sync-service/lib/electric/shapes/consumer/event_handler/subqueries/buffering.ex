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
  alias Electric.Shapes.Consumer.Subqueries.Views

  @enforce_keys [:shape_info, :queue, :active_move]
  defstruct [:shape_info, :queue, :active_move]

  @type t() :: %__MODULE__{
          shape_info: ShapeInfo.t(),
          queue: MoveQueue.t(),
          active_move: ActiveMove.t()
        }

  @spec start(
          ShapeInfo.t(),
          Views.t(),
          MoveQueue.t(),
          IndexChanges.move(),
          [String.t()],
          keyword()
        ) :: {:ok, t(), [Effects.t()]}
  def start(
        %ShapeInfo{} = shape_info,
        views,
        %MoveQueue{} = queue,
        {dep_move_kind, dep_index, values} = move,
        subquery_ref,
        opts \\ []
      )
      when is_map(views) do
    state = %__MODULE__{
      shape_info: shape_info,
      queue: queue,
      active_move:
        views
        |> ActiveMove.start(dep_index, dep_move_kind, subquery_ref, values)
        |> ActiveMove.carry_latest_seen_lsn(Keyword.get(opts, :latest_seen_lsn))
    }

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
    dep_view = Views.current(state.active_move.views_after_move, subquery_ref)

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
    with {:ok, splice_plan} <- SplicePlan.build(active_move, state.shape_info) do
      index_effects =
        IndexChanges.effects_for_complete(
          state.shape_info.dnf_plan,
          {active_move.dep_move_kind, active_move.dep_index, active_move.values},
          active_move.subquery_ref
        )

      steady_state = %Steady{
        shape_info: state.shape_info,
        views: active_move.views_after_move,
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
      views_before_move: active_move.views_before_move,
      views_after_move: active_move.views_after_move
    }
  end

  defp maybe_subscribe_global_lsn(effects, true) do
    EffectList.append(effects, %Effects.SubscribeGlobalLsn{})
  end

  defp maybe_subscribe_global_lsn(effects, false), do: effects

  defp maybe_notify_flushed(effects, nil), do: effects

  defp maybe_notify_flushed(effects, log_offset) do
    EffectList.append(effects, %Effects.NotifyFlushed{log_offset: log_offset})
  end
end
