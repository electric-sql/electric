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
  alias Electric.Shapes.Filter.Indexes.SubqueryIndex
  alias Electric.Shapes.Filter.Indexes.SubqueryIndex.MultiTimeView
  alias Electric.Shapes.Filter.Indexes.SubqueryIndex.ProgressMonitor

  @enforce_keys [:shape_info, :subquery_refs]
  defstruct [:shape_info, :subquery_refs, queue: MoveQueue.new()]

  @type subquery_ref_meta() :: %{subquery_id: term(), time: non_neg_integer()}
  @type subquery_refs() :: %{[String.t()] => subquery_ref_meta()}

  @type t() :: %__MODULE__{
          shape_info: ShapeInfo.t(),
          subquery_refs: subquery_refs(),
          queue: MoveQueue.t()
        }

  @impl true
  def handle_event(%__MODULE__{} = state, %Transaction{} = txn) do
    with {:ok, effects} <- append_txn_effects(txn, state) do
      {:ok, state, effects}
    end
  end

  def handle_event(%__MODULE__{} = state, {:global_last_seen_lsn, _lsn}) do
    {:ok, state, []}
  end

  def handle_event(
        %__MODULE__{
          shape_info: %ShapeInfo{dependency_move_policy: :invalidate_on_dependency_move}
        },
        {:materializer_changes, _dep_handle, _payload}
      ) do
    {:error, :unsupported_subquery}
  end

  def handle_event(%__MODULE__{} = state, {:materializer_changes, dep_handle, payload}) do
    subquery_ref = RefResolver.ref_from_dep_handle!(state.shape_info.ref_resolver, dep_handle)
    dep_index = subquery_ref |> List.last() |> String.to_integer()
    mtv = MultiTimeView.for_stack(state.shape_info.stack_id)
    %{subquery_id: subquery_id, time: pinned_time} = Map.fetch!(state.subquery_refs, subquery_ref)
    dep_view = mtv |> MultiTimeView.values(subquery_id, pinned_time) |> MapSet.new()
    next_state = %{state | queue: MoveQueue.enqueue(state.queue, dep_index, payload, dep_view)}

    with {:ok, next_state, effects} <-
           drain_queue(next_state, EffectList.new(), payload_time: payload[:to_time]) do
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

      {{dep_move_kind, dep_index, values, txids} = move, batch_to_time, queue} ->
        subquery_ref = RefResolver.ref_from_dep_index!(state.shape_info.ref_resolver, dep_index)
        subscription_active? = Keyword.get(opts, :subscription_active?, false)
        latest_seen_lsn = Keyword.get(opts, :latest_seen_lsn)

        case outer_move_kind(state.shape_info, dep_index, dep_move_kind) do
          :move_in ->
            %{time: from_time} = Map.fetch!(state.subquery_refs, subquery_ref)
            to_time = batch_to_time || Keyword.get(opts, :payload_time, from_time)

            with {:ok, next_state, start_effects} <-
                   Buffering.start(
                     state.shape_info,
                     state.subquery_refs,
                     queue,
                     move,
                     subquery_ref,
                     from_time,
                     to_time,
                     subscribe_global_lsn?: not subscription_active?,
                     latest_seen_lsn: latest_seen_lsn
                   ) do
              {:ok, next_state, EffectList.append_all(effects, start_effects)}
            end

          :move_out ->
            %{subquery_id: subquery_id} = Map.fetch!(state.subquery_refs, subquery_ref)
            from_time = state.subquery_refs[subquery_ref].time
            same_dep_move_in_pending? = Map.has_key?(queue.move_in, dep_index)
            to_time = batch_to_time || Keyword.get(opts, :payload_time, from_time)

            # When the same dep has a queued move-in waiting, leave
            # `subquery_refs.time` untouched: the upcoming Buffering session
            # owns the final time advance (so its move-in query reads
            # `views_before` at the pre-batch time and `views_after` at
            # `to_time`, with the diff yielding the newly-added values).
            next_subquery_refs =
              if same_dep_move_in_pending? do
                state.subquery_refs
              else
                advance_subquery_index_time(
                  state.shape_info,
                  subquery_ref,
                  subquery_id,
                  from_time,
                  to_time
                )

                advance_subquery_time(state.subquery_refs, subquery_ref, to_time)
              end

            next_state = %{state | queue: queue, subquery_refs: next_subquery_refs}

            index_effects =
              IndexChanges.effects_for_complete(state.shape_info.dnf_plan, move, subquery_ref)

            effects =
              effects
              |> EffectList.append(
                MoveBroadcast.effect_for_move_out(dep_index, values, txids, state.shape_info)
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

  defp advance_subquery_index_time(
         %ShapeInfo{} = shape_info,
         subquery_ref,
         subquery_id,
         from_time,
         to_time
       ) do
    case SubqueryIndex.for_stack(shape_info.stack_id) do
      nil ->
        :ok

      index ->
        SubqueryIndex.set_shape_subquery(
          index,
          shape_info.shape_handle,
          subquery_ref,
          subquery_id,
          to_time
        )

        ProgressMonitor.notify_processed_up_to(
          shape_info.stack_id,
          from_time,
          subquery_id,
          shape_info.shape_handle
        )
    end
  end

  @doc false
  def advance_subquery_time(subquery_refs, _subquery_ref, nil), do: subquery_refs

  def advance_subquery_time(subquery_refs, subquery_ref, to_time) do
    Map.update!(subquery_refs, subquery_ref, fn meta -> %{meta | time: to_time} end)
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

  defp append_txn_effects(%Transaction{} = txn, %__MODULE__{} = state) do
    mtv = MultiTimeView.for_stack(state.shape_info.stack_id)
    views = materialise_views(mtv, state.subquery_refs)

    with {:ok, effects} <-
           TransactionConverter.transaction_to_effects(
             txn,
             state.shape_info.shape,
             stack_id: state.shape_info.stack_id,
             shape_handle: state.shape_info.shape_handle,
             extra_refs: {views, views},
             dnf_plan: state.shape_info.dnf_plan
           ) do
      effects =
        effects
        |> EffectList.new()
        |> EffectList.append(%Effects.NotifyFlushed{log_offset: txn.last_log_offset})
        |> EffectList.to_list()

      {:ok, effects}
    end
  end

  defp materialise_views(nil, _refs), do: %{}

  defp materialise_views(mtv, subquery_refs) do
    Map.new(subquery_refs, fn {ref, %{subquery_id: id, time: time}} ->
      {ref, mtv |> MultiTimeView.values(id, time) |> MapSet.new()}
    end)
  end
end
