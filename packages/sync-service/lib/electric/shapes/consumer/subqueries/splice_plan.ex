defmodule Electric.Shapes.Consumer.Subqueries.SplicePlan do
  @moduledoc false

  alias Electric.Replication.LogOffset
  alias Electric.Shapes.Consumer.EffectList
  alias Electric.Shapes.Consumer.Effects
  alias Electric.Shapes.Consumer.Subqueries.ActiveMove
  alias Electric.Shapes.Consumer.Subqueries.MoveBroadcast
  alias Electric.Shapes.Consumer.Subqueries.ShapeInfo
  alias Electric.Shapes.Consumer.TransactionConverter

  @enforce_keys [:effects]
  defstruct [:effects, :flushed_log_offset]

  @type t() :: %__MODULE__{
          effects: [Effects.t()],
          flushed_log_offset: LogOffset.t() | nil
        }

  @spec build(ActiveMove.t(), ShapeInfo.t()) :: {:ok, t()} | {:error, term()}
  def build(%ActiveMove{} = active_move, %ShapeInfo{} = shape_info) do
    {pre_txns, post_txns} = ActiveMove.split_buffer(active_move)

    with {:ok, pre_ops} <- convert_txns(pre_txns, shape_info, active_move.views_before_move),
         {:ok, post_ops} <- convert_txns(post_txns, shape_info, active_move.views_after_move) do
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

  defp move_in_snapshot_effect(%ActiveMove{} = active_move) do
    %Effects.AppendMoveInSnapshot{
      snapshot_name: active_move.move_in_snapshot_name,
      row_count: active_move.move_in_row_count,
      row_bytes: active_move.move_in_row_bytes,
      snapshot: active_move.snapshot
    }
  end
end
