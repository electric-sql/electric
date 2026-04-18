defmodule Electric.Shapes.Consumer.Subqueries.MoveBroadcast do
  # Builds the control messages that tell materializers which tag positions moved.

  alias Electric.Shapes.Consumer.Effects
  alias Electric.Shapes.Consumer.Subqueries.ShapeInfo
  alias Electric.Shapes.DnfPlan
  alias Electric.Shapes.SubqueryTags

  @type move_value() :: {term(), term()}
  @type move() :: %{dep_index: non_neg_integer(), values: [move_value()]}

  @spec effect_for_move_in(move(), ShapeInfo.t()) :: %Effects.AppendControl{}
  def effect_for_move_in(active_move, %ShapeInfo{} = shape_info) do
    %Effects.AppendControl{
      message:
        make(
          shape_info.dnf_plan,
          active_move.dep_index,
          active_move.values,
          "move-in",
          shape_info.stack_id,
          shape_info.shape_handle
        )
    }
  end

  @spec effect_for_move_out(non_neg_integer(), [move_value()], ShapeInfo.t()) ::
          %Effects.AppendControl{}
  def effect_for_move_out(dep_index, values, %ShapeInfo{} = shape_info) do
    %Effects.AppendControl{
      message:
        make(
          shape_info.dnf_plan,
          dep_index,
          values,
          "move-out",
          shape_info.stack_id,
          shape_info.shape_handle
        )
    }
  end

  @spec make(
          DnfPlan.t(),
          non_neg_integer(),
          [move_value()],
          String.t(),
          String.t(),
          String.t()
        ) :: map()
  defp make(plan, dep_index, values, event, stack_id, shape_handle)
       when event in ["move-in", "move-out"] do
    positions = Map.get(plan.dependency_positions, dep_index, [])

    patterns =
      Enum.flat_map(positions, fn pos ->
        info = plan.positions[pos]

        Enum.map(values, fn {_typed_value, original_value} ->
          %{pos: pos, value: make_hash(info, stack_id, shape_handle, original_value)}
        end)
      end)

    %{headers: %{event: event, patterns: patterns}}
  end

  defp make_hash(%{tag_columns: [_col]}, stack_id, shape_handle, value) do
    SubqueryTags.make_value_hash(stack_id, shape_handle, value)
  end

  defp make_hash(
         %{tag_columns: {:hash_together, cols}},
         stack_id,
         shape_handle,
         original_value
       ) do
    parts =
      original_value
      |> Tuple.to_list()
      |> Enum.zip_with(cols, fn value, column ->
        column <> ":" <> SubqueryTags.namespace_value(value)
      end)

    SubqueryTags.make_value_hash_raw(stack_id, shape_handle, Enum.join(parts))
  end
end
