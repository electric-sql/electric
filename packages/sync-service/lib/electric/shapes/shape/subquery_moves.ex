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

  **IMPORTANT for OR queries**: When the WHERE clause contains OR-combined subqueries,
  simply replacing the subquery isn't enough - the query could still return rows from
  other OR branches. To prevent this, we add an AND constraint that forces only rows
  matching the moved-in values to be returned.

  For example, `WHERE x IN (subq1) OR y IN (subq2)` when processing move-ins for subq1
  becomes: `WHERE (x = ANY($1::...) OR y IN (subq2)) AND x = ANY($1::...)`
  """
  def move_in_where_clause(
        %Shape{
          where: %{query: query, used_refs: used_refs},
          shape_dependencies: shape_dependencies,
          shape_dependencies_handles: shape_dependencies_handles,
          subquery_comparison_expressions: comparison_expressions
        } = shape,
        shape_handle,
        move_ins
      ) do
    index = Enum.find_index(shape_dependencies_handles, &(&1 == shape_handle))
    target_section = Enum.at(shape_dependencies, index) |> rebuild_subquery_section()
    sublink_ref = ["$sublink", "#{index}"]

    # Determine if the WHERE clause has an OR with a subquery.
    # We need to add a forced AND constraint whenever there's an OR that includes
    # a sublink reference, not just when there are multiple dependencies.
    # For example: `x IN (subq) OR status = 'active'` has only one dependency
    # but still needs the forced AND to avoid returning unrelated rows.
    needs_forced_and = or_with_subquery?(shape)

    # Get the comparison expression to build the AND-forcing constraint
    testexpr = comparison_expressions[sublink_ref]

    case used_refs[sublink_ref] do
      {:array, {:row, cols}} ->
        unnest_sections =
          cols
          |> Enum.map(&Electric.Replication.Eval.type_to_pg_cast/1)
          |> Enum.with_index(fn col, i -> "$#{i + 1}::text[]::#{col}[]" end)
          |> Enum.join(", ")

        replacement = "IN (SELECT * FROM unnest(#{unnest_sections}))"
        params = Electric.Utils.unzip_any(move_ins) |> Tuple.to_list()

        base_query = String.replace(query, target_section, replacement)

        # For OR queries with subqueries, add AND constraint to avoid returning unrelated rows
        if needs_forced_and do
          forced_clause = build_forced_clause(testexpr, shape, unnest_sections)
          {"(#{base_query}) AND #{forced_clause}", params}
        else
          {base_query, params}
        end

      col ->
        type = Electric.Replication.Eval.type_to_pg_cast(col)
        replacement = "= ANY ($1::text[]::#{type})"
        params = [move_ins]

        base_query = String.replace(query, target_section, replacement)

        # For OR queries with subqueries, add AND constraint to avoid returning unrelated rows
        if needs_forced_and do
          forced_clause = build_forced_clause(testexpr, shape, "$1::text[]::#{type}")
          {"(#{base_query}) AND #{forced_clause}", params}
        else
          {base_query, params}
        end
    end
  end

  # Build the AND-forcing clause based on the test expression
  defp build_forced_clause(nil, _shape, _param_section), do: "true"

  defp build_forced_clause(%{eval: eval}, _shape, param_section) do
    build_forced_clause_from_eval(eval, param_section)
  end

  defp build_forced_clause_from_eval(%Eval.Parser.Ref{path: [column]}, param_section) do
    # Single column case: col = ANY($1::...)
    "#{Electric.Utils.quote_name(column)} = ANY (#{param_section})"
  end

  defp build_forced_clause_from_eval(%Eval.Parser.RowExpr{elements: elements}, param_section) do
    # Composite key case: (col1, col2) IN (SELECT * FROM unnest(...))
    columns =
      elements
      |> Enum.map(fn %Eval.Parser.Ref{path: [col]} -> Electric.Utils.quote_name(col) end)
      |> Enum.join(", ")

    "(#{columns}) IN (SELECT * FROM unnest(#{param_section}))"
  end

  defp build_forced_clause_from_eval(_, _param_section), do: "true"

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

  Now supports multiple dependencies - each move_out is processed only for its specific dependency.
  """
  @spec make_move_out_control_message(Shape.t(), String.t(), String.t(), [
          {dep_handle :: String.t(), gone_values :: String.t()},
          ...
        ]) :: map()
  def make_move_out_control_message(shape, stack_id, shape_handle, move_outs) do
    %{
      headers: %{
        event: "move-out",
        patterns:
          Enum.flat_map(move_outs, &make_move_out_pattern(shape, stack_id, shape_handle, &1))
      }
    }
  end

  # Generate move-out patterns for a specific dependency
  defp make_move_out_pattern(
         %{tag_structure: tag_structure_map, shape_dependencies_handles: dep_handles},
         stack_id,
         shape_handle,
         {dep_handle, gone_values}
       ) do
    # Find the index of this dependency
    index = Enum.find_index(dep_handles, &(&1 == dep_handle))
    sublink_index = Integer.to_string(index)
    sublink_ref = ["$sublink", sublink_index]

    # Get the pattern for this specific dependency from the tag_structure map
    case Map.get(tag_structure_map, sublink_ref) do
      nil ->
        # No pattern for this dependency - shouldn't happen but handle gracefully
        []

      pattern ->
        # Process the pattern (which is a list with one column_or_expr element)
        Enum.flat_map(pattern, fn column_or_expr ->
          case column_or_expr do
            column_name when is_binary(column_name) ->
              Enum.map(
                gone_values,
                &%{pos: 0, value: make_value_hash(stack_id, shape_handle, sublink_index, elem(&1, 1))}
              )

            {:hash_together, columns} ->
              column_parts =
                &(Enum.zip_with(&1, columns, fn value, column -> column <> ":" <> value end)
                  |> Enum.join(":"))

              Enum.map(
                gone_values,
                &%{
                  pos: 0,
                  value:
                    make_value_hash(stack_id, shape_handle, sublink_index, column_parts.(Tuple.to_list(elem(&1, 1))))
                }
              )
          end
        end)
    end
  end

  @doc """
  Create a hash for a value that includes the dependency index to ensure
  tags from different subqueries don't collide even if they have the same value.
  """
  def make_value_hash(stack_id, shape_handle, sublink_index, value) do
    :crypto.hash(:md5, "#{stack_id}#{shape_handle}sublink:#{sublink_index}:#{value}")
    |> Base.encode16(case: :lower)
  end

  # Backward compatibility wrapper - defaults to sublink_index "0"
  def make_value_hash(stack_id, shape_handle, value) do
    make_value_hash(stack_id, shape_handle, "0", value)
  end

  @doc """
  Generate a tag structure for a shape.

  A tag structure is now a map from sublink reference path (e.g. ["$sublink", "0"]) to the
  pattern for that dependency. This allows:
  - Proper per-dependency tagging for multiple OR-combined subqueries
  - Move-outs that only affect the correct dependency

  The pattern for each dependency is a list containing either:
  - A single column name (string) for simple IN checks
  - `{:hash_together, columns}` for composite key checks like `(a, b) IN (SELECT ...)`

  Example tag_structure for `WHERE x IN (subq1) OR y IN (subq2)`:
  ```
  %{
    ["$sublink", "0"] => ["x"],
    ["$sublink", "1"] => ["y"]
  }
  ```
  """
  @spec move_in_tag_structure(Shape.t()) ::
          {%{[String.t()] => [String.t() | {:hash_together, [String.t(), ...]}]}, %{}}
  def move_in_tag_structure(%Shape{} = shape)
      when is_nil(shape.where)
      when shape.shape_dependencies == [],
      do: {%{}, %{}}

  def move_in_tag_structure(shape) do
    # Walk the AST and build a map of sublink_ref path -> pattern for each dependency
    {:ok, {tag_structure_map, comparison_expressions}} =
      Walker.reduce(
        shape.where.eval,
        fn
          %Eval.Parser.Func{name: "sublink_membership_check", args: [testexpr, sublink_ref]},
          {tag_structure_map, comparison_expressions},
          _ ->
            pattern =
              case testexpr do
                %Eval.Parser.Ref{path: [column_name]} ->
                  [column_name]

                %Eval.Parser.RowExpr{elements: elements} ->
                  columns =
                    Enum.map(elements, fn %Eval.Parser.Ref{path: [column_name]} ->
                      column_name
                    end)

                  [{:hash_together, columns}]
              end

            tag_structure_map = Map.put(tag_structure_map, sublink_ref.path, pattern)
            comparison_expressions = Map.put(comparison_expressions, sublink_ref.path, testexpr)

            {:ok, {tag_structure_map, comparison_expressions}}

          _, acc, _ ->
            {:ok, acc}
        end,
        {%{}, %{}}
      )

    comparison_expressions =
      Map.new(comparison_expressions, fn {path, expr} -> {path, Eval.Expr.wrap_parser_part(expr)} end)

    {tag_structure_map, comparison_expressions}
  end

  # Check if the WHERE clause has an OR node whose subtree contains a sublink reference.
  # This is used to determine if we need to add a forced AND constraint to move-in queries.
  # If there are no dependencies, there can't be an OR-with-subquery.
  # Note: If there are dependencies, there must be a WHERE clause (subqueries require it).
  defp or_with_subquery?(%Shape{shape_dependencies: deps}) when deps == [], do: false

  defp or_with_subquery?(%Shape{where: where}) do
    Walker.reduce!(
      where.eval,
      fn
        %Eval.Parser.Func{name: "or"} = or_node, acc, _ctx ->
          if subtree_has_sublink?(or_node) do
            {:ok, true}
          else
            {:ok, acc}
          end

        _node, acc, _ctx ->
          {:ok, acc}
      end,
      false
    )
  end

  defp subtree_has_sublink?(tree) do
    Walker.reduce!(
      tree,
      fn
        %Eval.Parser.Ref{path: ["$sublink", _]}, _acc, _ctx ->
          {:ok, true}

        _node, acc, _ctx ->
          {:ok, acc}
      end,
      false
    )
  end
end
