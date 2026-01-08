defmodule Electric.Shapes.Shape.SubqueryMoves do
  @moduledoc """
  Handles subquery move-in and move-out logic for shapes with subqueries.

  ## DNF (Disjunctive Normal Form) Support

  This module supports full DNF for WHERE clauses containing subqueries. DNF means
  a disjunction (OR) of conjunctions (ANDs), e.g.:

      (A AND B) OR (C AND D) OR E

  For tagging purposes:
  - Each disjunct becomes a separate "reason" for a row to be in the shape
  - A row gets a tag for each disjunct it satisfies
  - A row is deleted only when it has no remaining tags (no disjuncts satisfied)

  Examples:
  - `x IN (subq1) OR y IN (subq2)` → 2 disjuncts, each with 1 sublink
  - `x IN (subq1) AND y IN (subq2)` → 1 disjunct with 2 sublinks
  - `(x IN (subq1) AND z='foo') OR y IN (subq2)` → 2 disjuncts
  """
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

  For single-sublink disjuncts (OR-only cases):
    Patterns contain pre-computed tag hashes that can be directly matched.

  For multi-sublink disjuncts (AND-combined cases):
    Patterns contain information for the receiver to compute affected composite tags:
    - sublink_ref: which sublink moved out
    - values: which values moved out
    - affected_disjuncts: which disjunct indices need tag recomputation

  Now supports multiple dependencies - each move_out is processed only for its specific dependency.
  """
  @spec make_move_out_control_message(Shape.t(), String.t(), String.t(), [
          {dep_handle :: String.t(), gone_values :: String.t()},
          ...
        ]) :: map()
  def make_move_out_control_message(shape, stack_id, shape_handle, move_outs) do
    {simple_patterns, composite_patterns} =
      Enum.reduce(move_outs, {[], []}, fn move_out, {simple_acc, composite_acc} ->
        {simple, composite} = make_move_out_patterns(shape, stack_id, shape_handle, move_out)
        {simple ++ simple_acc, composite ++ composite_acc}
      end)

    headers =
      %{event: "move-out", patterns: simple_patterns}
      |> then(fn headers ->
        if composite_patterns == [] do
          headers
        else
          Map.put(headers, :composite_patterns, composite_patterns)
        end
      end)

    %{headers: headers}
  end

  # Generate move-out patterns for a specific dependency
  # Returns {simple_patterns, composite_patterns}
  defp make_move_out_patterns(
         %{dnf_structure: dnf_structure, shape_dependencies_handles: dep_handles, tag_structure: tag_structure} = shape,
         stack_id,
         shape_handle,
         {dep_handle, gone_values}
       ) do
    # Find the index of this dependency
    index = Enum.find_index(dep_handles, &(&1 == dep_handle))
    sublink_index = Integer.to_string(index)
    sublink_ref = ["$sublink", sublink_index]

    # Fallback to legacy behavior if dnf_structure is empty but tag_structure exists
    # This handles shapes created directly without going through Shape.new!
    if dnf_structure == [] and map_size(tag_structure) > 0 do
      make_move_out_patterns_legacy(tag_structure, stack_id, shape_handle, sublink_ref, gone_values)
    else
      make_move_out_patterns_dnf(dnf_structure, stack_id, shape_handle, sublink_ref, sublink_index, gone_values, shape)
    end
  end

  # Legacy pattern generation using tag_structure (for backward compatibility)
  defp make_move_out_patterns_legacy(tag_structure, stack_id, shape_handle, sublink_ref, gone_values) do
    case Map.get(tag_structure, sublink_ref) do
      nil ->
        {[], []}

      pattern ->
        sublink_index = List.last(sublink_ref)
        simple_patterns =
          Enum.flat_map(pattern, fn column_or_expr ->
            case column_or_expr do
              column_name when is_binary(column_name) ->
                Enum.map(gone_values, fn {_typed_value, string_value} ->
                  %{pos: 0, value: make_value_hash(stack_id, shape_handle, sublink_index, string_value)}
                end)

              {:hash_together, columns} ->
                column_parts =
                  &(Enum.zip_with(&1, columns, fn value, column -> column <> ":" <> value end)
                    |> Enum.join(":"))

                Enum.map(gone_values, fn {_typed_value, composite_string_value} ->
                  values = Tuple.to_list(composite_string_value)
                  %{pos: 0, value: make_value_hash(stack_id, shape_handle, sublink_index, column_parts.(values))}
                end)
            end
          end)

        {simple_patterns, []}
    end
  end

  # DNF-based pattern generation
  defp make_move_out_patterns_dnf(dnf_structure, stack_id, shape_handle, sublink_ref, sublink_index, gone_values, shape) do
    # Find which disjuncts contain this sublink and categorize them
    {single_sublink_disjuncts, multi_sublink_disjuncts} =
      dnf_structure
      |> Enum.with_index()
      |> Enum.filter(fn {disjunct, _idx} -> sublink_ref in disjunct.sublinks end)
      |> Enum.split_with(fn {disjunct, _idx} -> length(disjunct.sublinks) == 1 end)

    # For single-sublink disjuncts: generate simple pre-computed tags
    # Tag format: "d{disjunct_index}:{hash}"
    simple_patterns =
      Enum.flat_map(single_sublink_disjuncts, fn {disjunct, disjunct_index} ->
        pattern = Map.get(disjunct.patterns, sublink_ref, [])

        Enum.flat_map(pattern, fn column_or_expr ->
          case column_or_expr do
            column_name when is_binary(column_name) ->
              Enum.map(gone_values, fn {_typed_value, string_value} ->
                value_parts = "#{sublink_index}:#{string_value}"
                hash = make_disjunct_hash(stack_id, shape_handle, disjunct_index, value_parts)
                %{pos: 0, value: "d#{disjunct_index}:#{hash}"}
              end)

            {:hash_together, _columns} ->
              Enum.map(gone_values, fn {_typed_value, composite_string_value} ->
                values = Tuple.to_list(composite_string_value)
                column_values = Enum.join(values, ":")
                value_parts = "#{sublink_index}:#{column_values}"
                hash = make_disjunct_hash(stack_id, shape_handle, disjunct_index, value_parts)
                %{pos: 0, value: "d#{disjunct_index}:#{hash}"}
              end)
          end
        end)
      end)

    # For multi-sublink disjuncts: generate composite pattern info for receiver to compute
    composite_patterns =
      if multi_sublink_disjuncts == [] do
        []
      else
        affected_disjunct_indices = Enum.map(multi_sublink_disjuncts, fn {_disjunct, idx} -> idx end)
        pattern = get_sublink_pattern(shape, sublink_ref)

        gone_string_values =
          Enum.map(gone_values, fn {_typed_value, string_value} ->
            if is_tuple(string_value), do: Tuple.to_list(string_value), else: string_value
          end)

        [
          %{
            sublink_index: sublink_index,
            values: gone_string_values,
            affected_disjuncts: affected_disjunct_indices,
            pattern: pattern
          }
        ]
      end

    {simple_patterns, composite_patterns}
  end

  # Get the pattern (column names) for a sublink from the shape's tag structure
  defp get_sublink_pattern(%{tag_structure: tag_structure}, sublink_ref) do
    case Map.get(tag_structure, sublink_ref, []) do
      [column] when is_binary(column) -> [column]
      [{:hash_together, columns}] -> columns
      _ -> []
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
  Create a hash for a disjunct tag. This is used for AND-combined subqueries
  where the tag represents the entire disjunct being satisfied.

  The hash includes:
  - stack_id and shape_handle (for uniqueness across shapes)
  - disjunct_index (to differentiate tags from different disjuncts)
  - value_parts (composite of all sublink values in the disjunct)
  """
  def make_disjunct_hash(stack_id, shape_handle, disjunct_index, value_parts) do
    :crypto.hash(:md5, "#{stack_id}#{shape_handle}disjunct:#{disjunct_index}:#{value_parts}")
    |> Base.encode16(case: :lower)
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

  @doc """
  Extract DNF (Disjunctive Normal Form) structure from a shape's WHERE clause.

  Returns a list of disjuncts, where each disjunct is a map containing:
  - `sublinks`: list of sublink ref paths involved in this disjunct
  - `patterns`: map of sublink_ref -> pattern (column names for tag hash)
  - `comparison_expressions`: map of sublink_ref -> expression (for membership checking)

  ## Examples

      # x IN (subq1) OR y IN (subq2) → 2 disjuncts, each with 1 sublink
      [
        %{sublinks: [["$sublink", "0"]], patterns: %{...}, ...},
        %{sublinks: [["$sublink", "1"]], patterns: %{...}, ...}
      ]

      # x IN (subq1) AND y IN (subq2) → 1 disjunct with 2 sublinks
      [
        %{sublinks: [["$sublink", "0"], ["$sublink", "1"]], patterns: %{...}, ...}
      ]
  """
  @spec extract_dnf_structure(Shape.t()) :: [Shape.disjunct()]
  def extract_dnf_structure(%Shape{} = shape)
      when is_nil(shape.where)
      when shape.shape_dependencies == [],
      do: []

  def extract_dnf_structure(%Shape{where: where}) do
    # Extract disjuncts from the top-level structure
    disjuncts = extract_disjuncts(where.eval)

    # For each disjunct, extract sublink information
    Enum.map(disjuncts, fn disjunct_ast ->
      {patterns, comparison_expressions} = extract_sublink_info(disjunct_ast)

      comparison_expressions =
        Map.new(comparison_expressions, fn {path, expr} ->
          {path, Eval.Expr.wrap_parser_part(expr)}
        end)

      %{
        sublinks: Map.keys(patterns) |> Enum.sort(),
        patterns: patterns,
        comparison_expressions: comparison_expressions
      }
    end)
  end

  # Extract top-level disjuncts from an OR tree.
  # If the top node is OR, each arg is a disjunct.
  # Otherwise, the entire tree is a single disjunct.
  defp extract_disjuncts(%Eval.Parser.Func{name: "or", args: args}) do
    # Flatten nested ORs into a list of disjuncts
    Enum.flat_map(args, &extract_disjuncts/1)
  end

  defp extract_disjuncts(ast), do: [ast]

  # Extract sublink patterns and comparison expressions from a disjunct AST
  defp extract_sublink_info(ast) do
    Walker.reduce!(
      ast,
      fn
        %Eval.Parser.Func{name: "sublink_membership_check", args: [testexpr, sublink_ref]},
        {patterns, comparison_expressions},
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

          patterns = Map.put(patterns, sublink_ref.path, pattern)
          comparison_expressions = Map.put(comparison_expressions, sublink_ref.path, testexpr)

          {:ok, {patterns, comparison_expressions}}

        _, acc, _ ->
          {:ok, acc}
      end,
      {%{}, %{}}
    )
  end

  @doc """
  Check if the shape has any disjunct with multiple sublinks (AND-combined subqueries).

  This is important because AND-combined subqueries require different handling:
  - Tags must be composite (include all sublink values in the disjunct)
  - Move-outs need to consider all values in the disjunct
  """
  @spec has_and_combined_subqueries?(Shape.t()) :: boolean()
  def has_and_combined_subqueries?(%Shape{} = shape) do
    shape
    |> extract_dnf_structure()
    |> Enum.any?(fn disjunct -> length(disjunct.sublinks) > 1 end)
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
