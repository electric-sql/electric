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
    member? = fn value -> MultiTimeView.member?(mtv, subquery_id, value, pinned_time) end

    payload_with_default_from_time = Map.put_new(Map.new(payload), :from_time, pinned_time)

    next_state = %{
      state
      | queue:
          MoveQueue.enqueue(state.queue, dep_index, payload_with_default_from_time, member?)
    }

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

      {batch, queue} ->
        subquery_ref =
          RefResolver.ref_from_dep_index!(state.shape_info.ref_resolver, batch.dep_index)

        polarity =
          Map.fetch!(state.shape_info.dnf_plan.dependency_polarities, batch.dep_index)

        if buffering_required?(polarity, batch) do
          start_buffering(state, queue, batch, subquery_ref, effects, opts)
        else
          process_inline(state, queue, batch, subquery_ref, polarity, effects, opts)
        end
    end
  end

  defp buffering_required?(:positive, %{move_in_values: [_ | _]}), do: true
  defp buffering_required?(:negated, %{move_out_values: [_ | _]}), do: true
  defp buffering_required?(_, _), do: false

  defp start_buffering(state, queue, batch, subquery_ref, effects, opts) do
    subscription_active? = Keyword.get(opts, :subscription_active?, false)
    latest_seen_lsn = Keyword.get(opts, :latest_seen_lsn)

    with {:ok, next_state, start_effects} <-
           Buffering.start(
             state.shape_info,
             state.subquery_refs,
             queue,
             batch,
             subquery_ref,
             subscribe_global_lsn?: not subscription_active?,
             latest_seen_lsn: latest_seen_lsn
           ) do
      {:ok, next_state, EffectList.append_all(effects, start_effects)}
    end
  end

  # Inline path: the batch carries only non-Buffering-kind moves (positive
  # polarity move-out, or negated polarity move-in). No PG query needed —
  # we broadcast the outer move-out, update routing, and advance time.
  defp process_inline(state, queue, batch, subquery_ref, polarity, effects, opts) do
    %{subquery_id: subquery_id, time: from_time} =
      Map.fetch!(state.subquery_refs, subquery_ref)

    to_time = batch.to_time || from_time

    {outer_move_out_values, outer_move_out_kind} =
      case polarity do
        :positive -> {batch.move_out_values, :move_out}
        :negated -> {batch.move_in_values, :move_in}
      end

    advance_subquery_index_time(
      state.shape_info,
      subquery_ref,
      subquery_id,
      from_time,
      to_time
    )

    next_subquery_refs = advance_subquery_time(state.subquery_refs, subquery_ref, to_time)
    next_state = %{state | queue: queue, subquery_refs: next_subquery_refs}

    move = {outer_move_out_kind, batch.dep_index, outer_move_out_values, batch.txids}

    index_effects =
      IndexChanges.effects_for_complete(state.shape_info.dnf_plan, move, subquery_ref)

    effects =
      effects
      |> EffectList.append(
        MoveBroadcast.effect_for_move_out(
          batch.dep_index,
          outer_move_out_values,
          batch.txids,
          state.shape_info
        )
      )
      |> EffectList.append_all(index_effects)

    drain_queue(next_state, effects, opts)
  end

  defp advance_subquery_index_time(
         %ShapeInfo{} = shape_info,
         _subquery_ref,
         subquery_id,
         from_time,
         _to_time
       ) do
    ProgressMonitor.notify_processed_up_to(
      shape_info.stack_id,
      from_time,
      subquery_id,
      shape_info.shape_handle
    )
  end

  @doc false
  def advance_subquery_time(subquery_refs, _subquery_ref, nil), do: subquery_refs

  def advance_subquery_time(subquery_refs, subquery_ref, to_time) do
    Map.update!(subquery_refs, subquery_ref, fn meta -> %{meta | time: to_time} end)
  end

  defp append_txn_effects(%Transaction{} = txn, %__MODULE__{} = state) do
    mtv = MultiTimeView.for_stack(state.shape_info.stack_id)

    member? =
      Electric.Shapes.WhereClause.subquery_member_from_mtv(mtv, state.subquery_refs)

    with {:ok, effects} <-
           TransactionConverter.transaction_to_effects(
             txn,
             state.shape_info.shape,
             stack_id: state.shape_info.stack_id,
             shape_handle: state.shape_info.shape_handle,
             extra_refs: {member?, member?},
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
end
