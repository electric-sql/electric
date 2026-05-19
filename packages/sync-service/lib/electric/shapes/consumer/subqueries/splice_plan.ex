defmodule Electric.Shapes.Consumer.Subqueries.SplicePlan do
  @moduledoc false

  alias Electric.Replication.LogOffset
  alias Electric.Shapes.Consumer.EffectList
  alias Electric.Shapes.Consumer.Effects
  alias Electric.Shapes.Consumer.Subqueries.ActiveMove
  alias Electric.Shapes.Consumer.Subqueries.MoveBroadcast
  alias Electric.Shapes.Consumer.Subqueries.ShapeInfo
  alias Electric.Shapes.Consumer.TransactionConverter
  alias Electric.Shapes.Filter.Indexes.SubqueryIndex.MultiTimeView

  @enforce_keys [:effects]
  defstruct [:effects, :flushed_log_offset]

  @type t() :: %__MODULE__{
          effects: [Effects.t()],
          flushed_log_offset: LogOffset.t() | nil
        }

  @spec build(ActiveMove.t(), ShapeInfo.t(), map()) :: {:ok, t()} | {:error, term()}
  def build(%ActiveMove{} = active_move, %ShapeInfo{} = shape_info, subquery_refs) do
    {pre_txns, post_txns} = ActiveMove.split_buffer(active_move)
    mtv = MultiTimeView.for_stack(shape_info.stack_id)
    views_before_move = views_at(mtv, subquery_refs, active_move.subquery_ref, active_move.from_time)
    views_after_move = views_at(mtv, subquery_refs, active_move.subquery_ref, active_move.to_time)

    with {:ok, pre_ops} <- convert_txns(pre_txns, shape_info, views_before_move),
         {:ok, post_ops} <- convert_txns(post_txns, shape_info, views_after_move) do
      effects =
        EffectList.new()
        |> EffectList.append_all(pre_ops)
        |> EffectList.append(MoveBroadcast.effect_for_move_in(active_move, shape_info))
        |> EffectList.append(move_in_snapshot_effect(active_move))
        |> EffectList.append_all(post_ops)
        |> EffectList.to_list()

      {:ok,
       %__MODULE__{
         effects: effects,
         flushed_log_offset: ActiveMove.last_buffered_log_offset(active_move)
       }}
    end
  end

  defp convert_txns(txns, %ShapeInfo{} = shape_info, views) when is_map(views) do
    TransactionConverter.transactions_to_effects(
      txns,
      shape_info.shape,
      stack_id: shape_info.stack_id,
      shape_handle: shape_info.shape_handle,
      extra_refs: {views, views},
      dnf_plan: shape_info.dnf_plan
    )
  end

  defp views_at(mtv, subquery_refs, trigger_ref, trigger_time) do
    Map.new(subquery_refs, fn {ref, %{subquery_id: id, time: time}} ->
      effective_time = if ref == trigger_ref, do: trigger_time, else: time
      {ref, mtv |> MultiTimeView.values(id, effective_time) |> MapSet.new()}
    end)
  end

  defp move_in_snapshot_effect(%ActiveMove{} = active_move) do
    %Effects.AppendMoveInSnapshot{
      snapshot_name: active_move.move_in_snapshot_name,
      row_count: active_move.move_in_row_count,
      row_bytes: active_move.move_in_row_bytes,
      snapshot: active_move.snapshot
    }
  end
end
