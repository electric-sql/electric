defmodule Electric.Shapes.Shape.SubqueryMoves do
  alias Electric.Replication.Eval
  alias Electric.Replication.Eval.Walker
  alias Electric.Shapes.Shape

  def move_in_where_clause(
        %Shape{
          where: %{query: query, used_refs: used_refs},
          shape_dependencies: shape_dependencies,
          shape_dependencies_handles: shape_dependencies_handles
        },
        shape_handle,
        move_ins
      ) do
    index = Enum.find_index(shape_dependencies_handles, &(&1 == shape_handle))
    target_section = Enum.at(shape_dependencies, index) |> rebuild_subquery_section()
    type = used_refs[["$sublink", "#{index}"]] |> Electric.Replication.Eval.type_to_pg_cast()
    {String.replace(query, target_section, "= ANY ($1::text[]::#{type})"), [move_ins]}
  end

  defp rebuild_subquery_section(shape) do
    ~s|IN (SELECT #{Enum.join(shape.explicitly_selected_columns, ", ")} FROM #{Electric.Utils.relation_to_sql(shape.root_table)} WHERE #{shape.where.query})|
  end

  @doc """
  Generate a tag-removal control message for a shape and
  """
  @spec make_move_out_control_message(Shape.t(), [
          {dep_handle :: String.t(), gone_values :: String.t()},
          ...
        ]) :: map()
  # Stub guard to allow only one dependency for now.
  def make_move_out_control_message(shape, [_] = move_outs) do
    %{
      headers: %{
        event: "move_out",
        patterns: Enum.flat_map(move_outs, &make_move_out_pattern(shape, &1))
      }
    }
  end

  # This is a stub implementation valid only for when there is exactly one dependency.
  defp make_move_out_pattern(_shape, {_dep_handle, gone_values}) do
    # Patterns are a list of tuples (represented as lists for JSON serialization)
    Enum.map(gone_values, &List.wrap/1)
  end

  def move_in_tag_structure(%Shape{} = shape)
      when is_nil(shape.where)
      when shape.shape_dependencies == [],
      do: []

  def move_in_tag_structure(shape) do
    # TODO: For multiple subqueries this should be a DNF form
    {:ok, tag_structure} =
      Walker.reduce(
        shape.where.eval,
        fn
          %Eval.Parser.Func{name: "sublink_membership_check", args: [ref, _]},
          [current_tag | others],
          _ ->
            %Eval.Parser.Ref{path: [column_name]} = ref

            {:ok, [[column_name | current_tag] | others]}

          _, acc, _ ->
            {:ok, acc}
        end,
        [[]]
      )

    tag_structure
  end
end
