defmodule Electric.Shapes.Shape.SubqueryMoves do
  @moduledoc false
  alias Electric.Replication.Eval
  alias Electric.Replication.Eval.Walker
  alias Electric.Shapes.Shape

  @value_prefix "v:"
  @null_sentinel "NULL"

  def value_prefix, do: @value_prefix
  def null_sentinel, do: @null_sentinel

  @doc """
  Build a WHERE clause for querying rows that should move into the shape.

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

  Options:
  - `:remove_not` - if true, removes any NOT prefix before the IN subquery.
    This is needed for NOT IN shapes where move-out from the subquery
    triggers move-in to the outer shape.
  """
  def move_in_where_clause(shape, shape_handle, move_ins) do
    move_in_where_clause(shape, shape_handle, move_ins, remove_not: false)
  end

  def move_in_where_clause(
        %Shape{
          where: %{query: query, used_refs: used_refs},
          shape_dependencies: shape_dependencies,
          shape_dependencies_handles: shape_dependencies_handles,
          subquery_comparison_expressions: comparison_expressions
        } = shape,
        shape_handle,
        move_ins,
        opts
      ) do
    index = Enum.find_index(shape_dependencies_handles, &(&1 == shape_handle))
    target_section = Enum.at(shape_dependencies, index) |> rebuild_subquery_section()

    # For NOT IN shapes, we need to remove the NOT when querying for new rows
    # because the values are now NOT in the subquery (they were removed)
    query =
      if Keyword.get(opts, :remove_not, false) do
        remove_not_before_section(query, target_section)
      else
        query
      end

    # Build exclusion clauses for other subqueries to avoid duplicate inserts
    # when a row is already in the shape via another disjunct
    exclusion_clauses =
      if Shape.has_multiple_disjuncts?(shape) do
        build_exclusion_clauses(
          shape_dependencies,
          shape_dependencies_handles,
          comparison_expressions,
          index
        )
      else
        ""
      end

    case used_refs[["$sublink", "#{index}"]] do
      {:array, {:row, cols}} ->
        unnest_sections =
          cols
          |> Enum.map(&Electric.Replication.Eval.type_to_pg_cast/1)
          |> Enum.with_index(fn col, index -> "$#{index + 1}::text[]::#{col}[]" end)
          |> Enum.join(", ")

        base_query =
          String.replace(query, target_section, "IN (SELECT * FROM unnest(#{unnest_sections}))")

        # Wrap in parentheses to avoid precedence issues with OR and AND
        final_query =
          if exclusion_clauses != "", do: "(#{base_query})#{exclusion_clauses}", else: base_query

        {final_query, Electric.Utils.unzip_any(move_ins) |> Tuple.to_list()}

      col ->
        type = Electric.Replication.Eval.type_to_pg_cast(col)
        base_query = String.replace(query, target_section, "= ANY ($1::text[]::#{type})")
        # Wrap in parentheses to avoid precedence issues with OR and AND
        final_query =
          if exclusion_clauses != "", do: "(#{base_query})#{exclusion_clauses}", else: base_query

        {final_query, [move_ins]}
    end
  end

  # Build exclusion clauses for other subqueries to prevent duplicate inserts
  # This generates SQL like: AND NOT (column IN (SELECT ...))
  defp build_exclusion_clauses(
         shape_dependencies,
         _handles,
         comparison_expressions,
         current_index
       ) do
    other_indices =
      0..(length(shape_dependencies) - 1)
      |> Enum.reject(&(&1 == current_index))

    clauses =
      Enum.map(other_indices, fn idx ->
        subquery_shape = Enum.at(shape_dependencies, idx)
        subquery_section = rebuild_subquery_section(subquery_shape)

        # Get the column reference for this subquery
        column_sql = get_column_sql(comparison_expressions, idx)

        if column_sql do
          " AND NOT (#{column_sql} #{subquery_section})"
        else
          ""
        end
      end)

    Enum.join(clauses)
  end

  # Get the SQL for the column that references a subquery
  defp get_column_sql(comparison_expressions, subquery_index) do
    path = ["$sublink", "#{subquery_index}"]

    case Map.get(comparison_expressions, path) do
      %{eval: %Eval.Parser.Ref{path: [column_name]}} ->
        # Simple column reference
        ~s["#{column_name}"]

      %{eval: %Eval.Parser.RowExpr{elements: elements}} ->
        # Multi-column reference (ROW expression)
        columns =
          Enum.map(elements, fn
            %Eval.Parser.Ref{path: [col]} -> ~s["#{col}"]
            _ -> nil
          end)

        if Enum.any?(columns, &is_nil/1) do
          nil
        else
          "(#{Enum.join(columns, ", ")})"
        end

      _ ->
        nil
    end
  end

  # Remove "NOT " prefix before the subquery column and IN clause
  # The query has form like "NOT column_name IN (SELECT ...)"
  # We need to find and remove the "NOT " that precedes this pattern
  defp remove_not_before_section(query, target_section) do
    # The target_section is like "IN (SELECT id FROM table WHERE ...)"
    # We need to find "NOT <anything> IN (SELECT..." and remove "NOT "
    # Using regex to match "NOT " followed by anything then the target_section
    pattern = ~r/NOT\s+(\S+\s+)#{Regex.escape(target_section)}/i

    case Regex.run(pattern, query) do
      [match, column_part] ->
        # Found pattern, remove the "NOT " but keep the column_part and target_section
        String.replace(query, match, column_part <> target_section)

      nil ->
        # No match found, return query unchanged
        query
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
  def make_move_out_control_message(shape, stack_id, shape_handle, move_outs) do
    %{
      headers: %{
        event: "move-out",
        patterns:
          Enum.flat_map(move_outs, &make_move_out_pattern(shape, stack_id, shape_handle, &1))
      }
    }
  end

  # Generate move-out patterns for DNF-aware tag structure
  # Each pattern corresponds to a disjunct, and we need to identify which disjunct(s)
  # are affected by this dependency
  defp make_move_out_pattern(
         %{tag_structure: patterns, shape_dependencies_handles: dep_handles} = _shape,
         stack_id,
         shape_handle,
         {dep_handle, gone_values}
       ) do
    # Find which dependency index this handle corresponds to
    dep_index = Enum.find_index(dep_handles, &(&1 == dep_handle)) || 0

    # With DNF, each pattern (disjunct) may have columns from different subqueries
    # We need to find patterns that contain the column for this dependency
    patterns
    |> Enum.with_index()
    |> Enum.flat_map(fn {pattern, pattern_idx} ->
      # Check if this pattern references the affected dependency
      # For simplicity, we check if the pattern index matches the dependency index
      # This assumes disjuncts are ordered to match dependencies
      if pattern_idx == dep_index or length(dep_handles) == 1 do
        make_pattern_values(pattern, pattern_idx, gone_values, stack_id, shape_handle)
      else
        []
      end
    end)
  end

  # Generate move-out values for a single pattern (disjunct)
  defp make_pattern_values(pattern, pattern_idx, gone_values, stack_id, shape_handle) do
    case pattern do
      [column_name] when is_binary(column_name) ->
        Enum.map(
          gone_values,
          &%{pos: pattern_idx, value: make_value_hash(stack_id, shape_handle, elem(&1, 1))}
        )

      [{:hash_together, columns}] ->
        column_parts =
          &(Enum.zip_with(&1, columns, fn value, column ->
              column <> ":" <> namespace_value(value)
            end)
            |> Enum.join())

        Enum.map(
          gone_values,
          &%{
            pos: pattern_idx,
            value:
              make_value_hash_raw(
                stack_id,
                shape_handle,
                column_parts.(Tuple.to_list(elem(&1, 1)))
              )
          }
        )

      # Handle multi-column patterns (shouldn't happen with DNF but be safe)
      columns when is_list(columns) ->
        # Take the first column that matches a string
        case Enum.find(columns, &is_binary/1) do
          nil ->
            []

          _column_name ->
            Enum.map(
              gone_values,
              &%{pos: pattern_idx, value: make_value_hash(stack_id, shape_handle, elem(&1, 1))}
            )
        end

      # Empty pattern
      [] ->
        []
    end
  end

  def make_value_hash(stack_id, shape_handle, value) do
    make_value_hash_raw(stack_id, shape_handle, namespace_value(value))
  end

  @doc """
  Hash a pre-namespaced value. Use `make_value_hash/3` for single values that need namespacing.
  """
  def make_value_hash_raw(stack_id, shape_handle, namespaced_value) do
    :crypto.hash(:md5, "#{stack_id}#{shape_handle}#{namespaced_value}")
    |> Base.encode16(case: :lower)
  end

  @doc """
  Namespace a value for hashing.

  To distinguish NULL from the literal string 'NULL', values are prefixed with
  'v:' and NULL becomes 'NULL' (no prefix). This MUST match the SQL logic in
  `Querying.pg_namespace_value_sql/1` - see lib/electric/shapes/querying.ex.
  """
  def namespace_value(nil), do: @null_sentinel
  def namespace_value(value), do: @value_prefix <> value

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
      do: {[], %{}}

  def move_in_tag_structure(shape) do
    # TODO: For multiple subqueries this should be a DNF form
    #       and this walking overrides the comparison expressions
    {:ok, {tag_structure, comparison_expressions}} =
      Walker.reduce(
        shape.where.eval,
        fn
          %Eval.Parser.Func{name: "sublink_membership_check", args: [testexpr, sublink_ref]},
          {[current_tag | others], comparison_expressions},
          _ ->
            tags =
              case testexpr do
                %Eval.Parser.Ref{path: [column_name]} ->
                  [[column_name | current_tag] | others]

                %Eval.Parser.RowExpr{elements: elements} ->
                  elements =
                    Enum.map(elements, fn %Eval.Parser.Ref{path: [column_name]} ->
                      column_name
                    end)

                  [[{:hash_together, elements} | current_tag] | others]
              end

            {:ok, {tags, Map.put(comparison_expressions, sublink_ref.path, testexpr)}}

          _, acc, _ ->
            {:ok, acc}
        end,
        {[[]], %{}}
      )

    comparison_expressions
    |> Map.new(fn {path, expr} -> {path, Eval.Expr.wrap_parser_part(expr)} end)
    |> then(&{tag_structure, &1})
  end
end
