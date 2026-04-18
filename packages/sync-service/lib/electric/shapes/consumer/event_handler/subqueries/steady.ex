defmodule Electric.Shapes.Consumer.EventHandler.Subqueries.Steady do
  # Handles events while the handler is in its steady, non-buffering state.

  @behaviour Electric.Shapes.Consumer.EventHandler

  alias Electric.Replication.Changes.Transaction
  alias Electric.Shapes.Consumer.EffectList
  alias Electric.Shapes.Consumer.Effects
  alias Electric.Shapes.Consumer.EventHandler.Subqueries.Buffering
  alias Electric.Shapes.Consumer.TransactionConverter
  alias Electric.Shapes.Consumer.Subqueries.IndexChanges
  alias Electric.Shapes.Consumer.Subqueries.MoveBroadcast
  alias Electric.Shapes.Consumer.Subqueries.MoveQueue
  alias Electric.Shapes.Consumer.Subqueries.RefResolver
  alias Electric.Shapes.Consumer.Subqueries.ShapeInfo
  alias Electric.Shapes.Consumer.Subqueries.Views

  @enforce_keys [:shape_info, :views]
  defstruct [:shape_info, :views, queue: MoveQueue.new()]

  @type t() :: %__MODULE__{
          shape_info: ShapeInfo.t(),
          views: Views.t(),
          queue: MoveQueue.t()
        }

  @impl true
  def handle_event(%__MODULE__{} = state, %Transaction{} = txn) do
    with {:ok, effects} <- append_txn_effects(txn, state.shape_info, state.views) do
      {:ok, state, effects}
    end
  end

  def handle_event(%__MODULE__{} = state, {:global_last_seen_lsn, _lsn}) do
    # Straggler message after unsubscribe; ignore.
    {:ok, state, []}
  end

  def handle_event(%__MODULE__{} = state, {:materializer_changes, dep_handle, payload}) do
    subquery_ref = RefResolver.ref_from_dep_handle!(state.shape_info.ref_resolver, dep_handle)
    dep_index = subquery_ref |> List.last() |> String.to_integer()
    dep_view = Views.current(state.views, subquery_ref)
    next_state = %{state | queue: MoveQueue.enqueue(state.queue, dep_index, payload, dep_view)}

    with {:ok, next_state, effects} <- drain_queue(next_state, EffectList.new()) do
      {:ok, next_state, EffectList.to_list(effects)}
    end
  end

  def handle_event(%__MODULE__{}, {:pg_snapshot_known, _snapshot}) do
    raise ArgumentError, "received {:pg_snapshot_known, snapshot} while no move-in is buffering"
  end

  def handle_event(
        %__MODULE__{},
        {:query_move_in_complete, _snapshot_name, _row_count, _row_bytes, _move_in_lsn}
      ) do
    raise ArgumentError,
          "received {:query_move_in_complete, snapshot_name, row_count, row_bytes, move_in_lsn} while no move-in is buffering"
  end

  @spec drain_queue(t(), EffectList.t(), keyword()) ::
          {:ok, t() | Buffering.t(), EffectList.t()} | {:error, term()}
  def drain_queue(%__MODULE__{} = state, effects, opts \\ []) do
    case MoveQueue.pop_next(state.queue) do
      nil ->
        {:ok, state, effects}

      {{dep_move_kind, dep_index, values} = move, queue} ->
        subquery_ref = RefResolver.ref_from_dep_index!(state.shape_info.ref_resolver, dep_index)
        subscription_active? = Keyword.get(opts, :subscription_active?, false)
        latest_seen_lsn = Keyword.get(opts, :latest_seen_lsn)

        case outer_move_kind(state.shape_info, dep_index, dep_move_kind) do
          :move_in ->
            with {:ok, next_state, start_effects} <-
                   Buffering.start(
                     state.shape_info,
                     state.views,
                     queue,
                     move,
                     subquery_ref,
                     subscribe_global_lsn?: not subscription_active?,
                     latest_seen_lsn: latest_seen_lsn
                   ) do
              {:ok, next_state, EffectList.append_all(effects, start_effects)}
            end

          :move_out ->
            next_state = %{
              state
              | queue: queue,
                views: Views.apply_move(state.views, subquery_ref, values, dep_move_kind)
            }

            index_effects =
              IndexChanges.effects_for_complete(state.shape_info.dnf_plan, move, subquery_ref)

            effects =
              effects
              |> EffectList.append(
                MoveBroadcast.effect_for_move_out(dep_index, values, state.shape_info)
              )
              |> EffectList.append_all(index_effects)

            drain_queue(
              next_state,
              effects,
              opts
            )
        end
    end
  end

  defp outer_move_kind(
         %ShapeInfo{dnf_plan: %{dependency_polarities: polarities}},
         dep_index,
         move_kind
       ) do
    case {Map.fetch!(polarities, dep_index), move_kind} do
      {:positive, effect} -> effect
      {:negated, :move_in} -> :move_out
      {:negated, :move_out} -> :move_in
    end
  end

  defp append_txn_effects(%Transaction{} = txn, %ShapeInfo{} = shape_info, views)
       when is_map(views) do
    with {:ok, effects} <-
           TransactionConverter.transaction_to_effects(
             txn,
             shape_info.shape,
             stack_id: shape_info.stack_id,
             shape_handle: shape_info.shape_handle,
             extra_refs: {views, views},
             dnf_plan: shape_info.dnf_plan
           ) do
      effects =
        effects
        |> EffectList.new()
        |> EffectList.append(%Effects.NotifyFlushed{log_offset: txn.last_log_offset})
        |> EffectList.to_list()

      {:ok, effects}
    end
  end
end
