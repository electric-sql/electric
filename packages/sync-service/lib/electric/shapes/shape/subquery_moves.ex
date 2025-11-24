defmodule Electric.Shapes.Shape.SubqueryMoves do
  @moduledoc false
  alias Electric.Replication.Eval
  alias Electric.Replication.Eval.Walker
  alias Electric.Shapes.Shape

  @doc """
  Given a shape with a where clause that contains a subquery, make a query that can use a
  list of value in place of the subquery.

  When we're querying for new data, we're only querying for a subset of entire query.
  To make that, we need to replace the subquery with a list of values.

  For example, if the shape has a where clause like this:

      ~S|WHERE parent_id IN (SELECT id FROM parent WHERE value = '1')|

  And we're querying for new data with a list of values like this:

      ["1", "2", "3"]

  Then the query will be transformed to:

      ~S|WHERE parent_id = ANY ($1::text[]::int8[])|

  And the parameters will be:

      [["1", "2", "3"]]
  """
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

    case used_refs[["$sublink", "#{index}"]] do
      {:array, {:row, cols}} ->
        unnest_sections =
          cols
          |> Enum.map(&Electric.Replication.Eval.type_to_pg_cast/1)
          |> Enum.with_index(fn col, index -> "$#{index + 1}::text[]::#{col}[]" end)
          |> Enum.join(", ")

        {String.replace(query, target_section, "IN (SELECT * FROM unnest(#{unnest_sections}))"),
         Electric.Utils.unzip_any(move_ins) |> Tuple.to_list()}

      col ->
        type = Electric.Replication.Eval.type_to_pg_cast(col)
        {String.replace(query, target_section, "= ANY ($1::text[]::#{type})"), [move_ins]}
    end
  end

  defp rebuild_subquery_section(shape) do
    base =
      ~s|IN (SELECT #{Enum.join(shape.explicitly_selected_columns, ", ")} FROM #{Electric.Utils.relation_to_sql(shape.root_table)}|

    where = if shape.where, do: " WHERE #{shape.where.query}", else: ""
    base <> where <> ")"
  end

  @doc """
  Generate a tag-removal control message for a shape.

  Patterns are a list of lists, where each inner list represents a pattern (and is functionally a tuple, but
  JSON can't directly represent tuples). This pattern is filled with actual values that have been removed.
  """
  @spec make_move_out_control_message(Shape.t(), String.t(), String.t(), [
          {dep_handle :: String.t(), gone_values :: String.t()},
          ...
        ]) :: map()
  # Stub guard to allow only one dependency for now.
  def make_move_out_control_message(shape, stack_id, shape_handle, [_] = move_outs) do
    %{
      headers: %{
        event: "move-out",
        patterns:
          Enum.flat_map(move_outs, &make_move_out_pattern(shape, stack_id, shape_handle, &1))
      }
    }
  end

  # This is a stub implementation valid only for when there is exactly one dependency.
  defp make_move_out_pattern(
         %{tag_structure: patterns},
         stack_id,
         shape_handle,
         {_dep_handle, gone_values}
       ) do
    # TODO: This makes the assumption of only one column per pattern.
    Enum.flat_map(patterns, fn [column_or_expr] ->
      case column_or_expr do
        column_name when is_binary(column_name) ->
          Enum.map(gone_values, &%{pos: 0, value: make_value_hash(stack_id, shape_handle, &1)})

        {:hash_together, columns} ->
          column_parts =
            &(Enum.zip_with(&1, columns, fn value, column -> column <> ":" <> value end)
              |> Enum.join())

          Enum.map(
            gone_values,
            &%{
              pos: 0,
              value: make_value_hash(stack_id, shape_handle, column_parts.(Tuple.to_list(&1)))
            }
          )
      end
    end)
  end

  def make_value_hash(stack_id, shape_handle, value) do
    :crypto.hash(:md5, "#{stack_id}#{shape_handle}#{value}")
    |> Base.encode16(case: :lower)
  end

  @doc """
  Generate a tag structure for a shape.

  A tag structure is a list of lists, where each inner list represents a tag (and is functionally a tuple, but
  JSON can't directly represent tuples). The structure is used to generate actual tags for each row, that act
  as a refenence as to why this row is part of the shape.

  Tag structure then is essentially a list of column names in correct positions that will get filled in
  with actual values from the row
  """
  @spec move_in_tag_structure(Shape.t()) ::
          list(list(String.t() | {:hash_together, [String.t(), ...]}))
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
          %Eval.Parser.Func{name: "sublink_membership_check", args: [testexpr, _]},
          [current_tag | others],
          _ ->
            case testexpr do
              %Eval.Parser.Ref{path: [column_name]} ->
                {:ok, [[column_name | current_tag] | others]}

              %Eval.Parser.RowExpr{elements: elements} ->
                elements =
                  Enum.map(elements, fn %Eval.Parser.Ref{path: [column_name]} ->
                    column_name
                  end)

                {:ok, [[{:hash_together, elements} | current_tag] | others]}
            end

          _, acc, _ ->
            {:ok, acc}
        end,
        [[]]
      )

    tag_structure
  end
end
