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
  alias Electric.Shapes.WhereClause

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

    before_member? =
      WhereClause.subquery_member_from_mtv(
        mtv,
        subquery_refs,
        {active_move.subquery_ref, active_move.from_time}
      )

    after_member? =
      WhereClause.subquery_member_from_mtv(
        mtv,
        subquery_refs,
        {active_move.subquery_ref, active_move.to_time}
      )

    polarity =
      Map.get(shape_info.dnf_plan.dependency_polarities, active_move.dep_index, :positive)

    with {:ok, pre_ops} <- convert_txns(pre_txns, shape_info, before_member?),
         {:ok, post_ops} <- convert_txns(post_txns, shape_info, after_member?) do
      effects =
        EffectList.new()
        |> EffectList.append_all(pre_ops)
        |> maybe_append_move_out_broadcast(active_move, shape_info, polarity)
        |> maybe_append_move_in_broadcast(active_move, shape_info, polarity)
        |> maybe_append_move_in_snapshot(active_move)
        |> EffectList.append_all(post_ops)
        |> EffectList.to_list()

      {:ok,
       %__MODULE__{
         effects: effects,
         flushed_log_offset: ActiveMove.last_buffered_log_offset(active_move)
       }}
    end
  end

  defp convert_txns(txns, %ShapeInfo{} = shape_info, member?) when is_function(member?, 2) do
    TransactionConverter.transactions_to_effects(
      txns,
      shape_info.shape,
      stack_id: shape_info.stack_id,
      shape_handle: shape_info.shape_handle,
      extra_refs: {member?, member?},
      dnf_plan: shape_info.dnf_plan
    )
  end

  # Outer-perspective move-out broadcast — values whose exit from the dep
  # view (positive) or entry into it (negated) drops rows out of the outer
  # shape.
  defp maybe_append_move_out_broadcast(effects, %ActiveMove{} = active_move, shape_info, polarity) do
    outer_move_out_values =
      case polarity do
        :positive -> active_move.move_out_values
        :negated -> active_move.move_in_values
      end

    case outer_move_out_values do
      [] ->
        effects

      values ->
        EffectList.append(
          effects,
          MoveBroadcast.effect_for_move_out(
            active_move.dep_index,
            values,
            active_move.txids,
            shape_info
          )
        )
    end
  end

  defp maybe_append_move_in_broadcast(effects, %ActiveMove{} = active_move, shape_info, polarity) do
    outer_move_in_values =
      case polarity do
        :positive -> active_move.move_in_values
        :negated -> active_move.move_out_values
      end

    if outer_move_in_values == [] do
      effects
    else
      EffectList.append(effects, MoveBroadcast.effect_for_move_in(active_move, shape_info))
    end
  end

  defp maybe_append_move_in_snapshot(effects, %ActiveMove{move_in_snapshot_name: nil}), do: effects

  defp maybe_append_move_in_snapshot(effects, %ActiveMove{} = active_move) do
    EffectList.append(effects, %Effects.AppendMoveInSnapshot{
      snapshot_name: active_move.move_in_snapshot_name,
      row_count: active_move.move_in_row_count,
      row_bytes: active_move.move_in_row_bytes,
      snapshot: active_move.snapshot
    })
  end
end
