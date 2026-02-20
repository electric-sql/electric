defmodule Electric.Shapes.Shape.SubqueryMoves do
  @moduledoc false
  alias Electric.Replication.Eval
  alias Electric.Replication.Eval.SqlGenerator
  alias Electric.Replication.Eval.Walker
  alias Electric.Shapes.Shape

  @value_prefix "v:"
  @null_sentinel "NULL"

  def value_prefix, do: @value_prefix
  def null_sentinel, do: @null_sentinel

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
  def move_in_where_clause(shape, shape_handle, move_ins, dnf_context \\ nil, opts \\ [])

  def move_in_where_clause(
        %Shape{
          where: %{query: query, used_refs: used_refs},
          shape_dependencies: shape_dependencies,
          shape_dependencies_handles: shape_dependencies_handles
        } = shape,
        shape_handle,
        move_ins,
        dnf_context,
        opts
      ) do
    index = Enum.find_index(shape_dependencies_handles, &(&1 == shape_handle))
    target_section = Enum.at(shape_dependencies, index) |> rebuild_subquery_section()

    # For negated positions (NOT IN), the original WHERE has "NOT IN (...)"
    # and we need to replace the whole "NOT IN (...)" to get correct SQL
    target_section = if opts[:remove_not], do: "NOT " <> target_section, else: target_section

    {where, params} =
      case used_refs[["$sublink", "#{index}"]] do
        {:array, {:row, cols}} ->
          unnest_sections =
            cols
            |> Enum.map(&Electric.Replication.Eval.type_to_pg_cast/1)
            |> Enum.with_index(fn col, index -> "$#{index + 1}::text[]::#{col}[]" end)
            |> Enum.join(", ")

          {String.replace(
             query,
             target_section,
             "IN (SELECT * FROM unnest(#{unnest_sections}))"
           ), Electric.Utils.unzip_any(move_ins) |> Tuple.to_list()}

        col ->
          type = Electric.Replication.Eval.type_to_pg_cast(col)
          {String.replace(query, target_section, "= ANY ($1::text[]::#{type})"), [move_ins]}
      end

    # Append exclusion clauses for multi-disjunct shapes
    exclusion =
      if dnf_context && dnf_context.decomposition &&
           length(dnf_context.decomposition.disjuncts) > 1 do
        build_dnf_exclusion_clauses(
          dnf_context.decomposition,
          shape.shape_dependencies,
          shape.subquery_comparison_expressions,
          index
        )
      else
        ""
      end

    {where <> exclusion, params}
  end

  defp rebuild_subquery_section(shape) do
    base =
      ~s|IN (SELECT #{Enum.join(shape.explicitly_selected_columns, ", ")} FROM #{Electric.Utils.relation_to_sql(shape.root_table)}|

    where = if shape.where, do: " WHERE #{shape.where.query}", else: ""
    base <> where <> ")"
  end

  @doc """
  Generate a tag-removal control message for a shape.

  Patterns are a list of maps with `pos` (DNF position) and `value` (hashed value).
  For DNF shapes, the position comes from the tag_structure: the position index in
  each disjunct pattern that has the subquery column for the given dependency.
  """
  def make_move_out_control_message(shape, stack_id, shape_handle, move_outs, dnf_context \\ nil) do
    %{
      headers: %{
        event: "move-out",
        patterns:
          Enum.flat_map(
            move_outs,
            &make_move_out_pattern(shape, stack_id, shape_handle, &1, dnf_context)
          )
      }
    }
  end

  defp make_move_out_pattern(
         %{tag_structure: tag_structure},
         stack_id,
         shape_handle,
         {dep_handle, gone_values},
         dnf_context
       ) do
    # Find positions with non-nil column entries across all disjuncts.
    # For a DNF tag structure like [["parent_id", nil], [nil, "parent_id"]],
    # the subquery column appears at different positions in different disjuncts.
    # We collect all (position, column_spec) pairs where the column is non-nil.
    position_columns =
      tag_structure
      |> Enum.flat_map(fn disjunct ->
        disjunct
        |> Enum.with_index()
        |> Enum.flat_map(fn
          {nil, _pos} -> []
          {col_spec, pos} -> [{pos, col_spec}]
        end)
      end)
      |> Enum.uniq_by(fn {pos, _} -> pos end)

    # When we have a DnfContext, only emit patterns for positions that belong
    # to the specific dependency that changed. Without this filtering, a move-out
    # from one subquery would incorrectly target positions for literal conditions
    # or other subqueries in different disjuncts.
    position_columns =
      case dnf_context do
        %{dependency_to_positions_map: dep_to_pos} when dep_to_pos != %{} ->
          case Map.get(dep_to_pos, dep_handle) do
            nil ->
              []

            dep_positions ->
              Enum.filter(position_columns, fn {pos, _} -> pos in dep_positions end)
          end

        _ ->
          position_columns
      end

    Enum.flat_map(position_columns, fn {pos, col_spec} ->
      make_patterns_for_position(pos, col_spec, gone_values, stack_id, shape_handle)
    end)
  end

  defp make_patterns_for_position(pos, column_name, gone_values, stack_id, shape_handle)
       when is_binary(column_name) do
    Enum.map(
      gone_values,
      &%{pos: pos, value: make_value_hash(stack_id, shape_handle, elem(&1, 1))}
    )
  end

  defp make_patterns_for_position(
         pos,
         {:hash_together, columns},
         gone_values,
         stack_id,
         shape_handle
       ) do
    column_parts =
      &(Enum.zip_with(&1, columns, fn value, column ->
          column <> ":" <> namespace_value(value)
        end)
        |> Enum.join())

    Enum.map(
      gone_values,
      &%{
        pos: pos,
        value:
          make_value_hash_raw(
            stack_id,
            shape_handle,
            column_parts.(Tuple.to_list(elem(&1, 1)))
          )
      }
    )
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
  Extract the sublink index from a sublink_membership_check AST node.
  """
  def extract_sublink_index(%Eval.Parser.Func{
        name: "sublink_membership_check",
        args: [_, %Eval.Parser.Ref{path: ["$sublink", idx_str]}]
      }) do
    String.to_integer(idx_str)
  end

  def extract_sublink_index(_), do: nil

  @doc """
  Find all DNF positions that correspond to a given dependency index.

  A single dependency can appear at multiple positions (e.g., the same subquery
  referenced in different parts of the WHERE clause).
  """
  def find_dnf_positions_for_dep_index(decomposition, dep_index) do
    Enum.flat_map(decomposition.subexpressions, fn {pos, subexpr} ->
      if subexpr.is_subquery and extract_sublink_index(subexpr.ast) == dep_index do
        [pos]
      else
        []
      end
    end)
  end

  @doc """
  Build exclusion clauses using DNF decomposition.

  Only excludes subqueries in disjuncts that do NOT contain the triggering dependency.
  For example, in `(x IN sq1 AND y IN sq2) OR z IN sq3`:
    - When sq1 triggers, sq2 is in the same disjunct so NOT excluded; sq3 IS excluded
  """
  def build_dnf_exclusion_clauses(
        decomposition,
        shape_dependencies,
        comparison_expressions,
        trigger_dep_index
      ) do
    trigger_positions = find_dnf_positions_for_dep_index(decomposition, trigger_dep_index)

    if trigger_positions == [] do
      ""
    else
      # Partition disjuncts into those containing vs not containing any trigger position
      {_containing, not_containing} =
        Enum.split_with(decomposition.disjuncts, fn conjunction ->
          Enum.any?(conjunction, fn {pos, _polarity} -> pos in trigger_positions end)
        end)

      # Generate exclusion for each disjunct NOT containing the trigger
      clauses =
        Enum.flat_map(not_containing, fn conjunction ->
          case generate_disjunct_exclusion(
                 conjunction,
                 decomposition,
                 shape_dependencies,
                 comparison_expressions
               ) do
            nil -> []
            clause -> [clause]
          end
        end)

      Enum.join(clauses)
    end
  end

  # Generate an exclusion clause for a single disjunct (conjunction of literals).
  # Returns nil if the disjunct contains any non-subquery positions (weaker exclusion
  # is safe since the client deduplicates via tags).
  # Otherwise returns " AND NOT (cond1 AND cond2 AND ...)"
  defp generate_disjunct_exclusion(
         conjunction,
         decomposition,
         shape_dependencies,
         comparison_expressions
       ) do
    all_subquery? =
      Enum.all?(conjunction, fn {pos, _polarity} ->
        case Map.get(decomposition.subexpressions, pos) do
          %{is_subquery: true} -> true
          _ -> false
        end
      end)

    if not all_subquery? do
      nil
    else
      conditions =
        Enum.flat_map(conjunction, fn {pos, polarity} ->
          info = Map.get(decomposition.subexpressions, pos)

          case extract_sublink_index(info.ast) do
            nil ->
              []

            dep_index ->
              subquery_shape = Enum.at(shape_dependencies, dep_index)
              subquery_section = rebuild_subquery_section(subquery_shape)
              column_sql = get_column_sql(comparison_expressions, dep_index)

              if column_sql do
                condition = "#{column_sql} #{subquery_section}"

                case polarity do
                  :positive -> [condition]
                  :negated -> ["NOT #{condition}"]
                end
              else
                []
              end
          end
        end)

      if conditions == [], do: nil, else: " AND NOT (#{Enum.join(conditions, " AND ")})"
    end
  end

  # Get the SQL for the column expression used in a subquery comparison.
  # Looks up the comparison expression by sublink index and converts to SQL.
  defp get_column_sql(comparison_expressions, dep_index) do
    key = ["$sublink", "#{dep_index}"]

    case Map.get(comparison_expressions, key) do
      nil -> nil
      %Eval.Expr{eval: ast} -> SqlGenerator.to_sql(ast)
    end
  end

  @doc """
  Build a multi-disjunct tag structure from a DNF decomposition.

  Returns `{tag_structure, comparison_expressions}` where tag_structure is a list
  of lists (one per disjunct), where each inner list has one entry per DNF position
  (nil for positions not in that disjunct, column name(s) for participating positions).

  Example for `WHERE (x IN sq1 AND status = 'active') OR y IN sq2`:
  - Position 0: `x IN sq1` → `"x"`
  - Position 1: `status = 'active'` → `"status"`
  - Position 2: `y IN sq2` → `"y"`
  - tag_structure: `[["x", "status", nil], [nil, nil, "y"]]`
  """
  def build_tag_structure_from_dnf(decomposition, shape) do
    %{subexpressions: subexpressions, position_count: position_count, disjuncts: disjuncts} =
      decomposition

    # Build column spec for each position from its AST
    position_columns =
      Map.new(0..(position_count - 1)//1, fn pos ->
        subexpr = Map.fetch!(subexpressions, pos)
        {pos, extract_columns_from_ast(subexpr.ast)}
      end)

    # Build comparison expressions for subquery positions
    comparison_expressions = build_comparison_expressions(subexpressions, position_count)

    # Build tag structure: one row per disjunct, one column per position
    tag_structure =
      Enum.map(disjuncts, fn conjunction ->
        active_positions = MapSet.new(conjunction, fn {pos, _polarity} -> pos end)

        Enum.map(0..(position_count - 1)//1, fn pos ->
          if MapSet.member?(active_positions, pos) do
            Map.fetch!(position_columns, pos)
          else
            nil
          end
        end)
      end)

    # For backward compat with move_in_where_clause, also gather comparison expressions
    # from the shape's AST walk (used by existing single-disjunct code paths)
    legacy_comparison_exprs = build_legacy_comparison_expressions(shape)

    {tag_structure, Map.merge(legacy_comparison_exprs, comparison_expressions)}
  end

  # Extract column name(s) from a subexpression's AST.
  # For `x IN (SELECT ...)` → "x"
  # For `(x, y) IN (SELECT ...)` → {:hash_together, ["x", "y"]}
  # For non-subquery conditions like `status = 'active'` → extract the column ref
  defp extract_columns_from_ast(ast) do
    columns =
      Walker.reduce!(
        ast,
        fn
          %Eval.Parser.Ref{path: [column_name]}, acc, _ctx ->
            {:ok, [column_name | acc]}

          _, acc, _ ->
            {:ok, acc}
        end,
        []
      )
      |> Enum.reverse()
      |> Enum.uniq()

    case columns do
      [single] -> single
      multiple when length(multiple) > 1 -> {:hash_together, multiple}
      # fallback: should not happen for valid expressions
      [] -> nil
    end
  end

  defp build_comparison_expressions(subexpressions, position_count) do
    Enum.reduce(0..(position_count - 1)//1, %{}, fn pos, acc ->
      subexpr = Map.fetch!(subexpressions, pos)

      if subexpr.is_subquery do
        case subexpr.ast do
          %Eval.Parser.Func{name: "sublink_membership_check", args: [testexpr, sublink_ref]} ->
            Map.put(acc, sublink_ref.path, Eval.Expr.wrap_parser_part(testexpr))

          _ ->
            acc
        end
      else
        acc
      end
    end)
  end

  # Build comparison expressions the legacy way for backward compat
  defp build_legacy_comparison_expressions(%Shape{where: nil}), do: %{}
  defp build_legacy_comparison_expressions(%Shape{shape_dependencies: []}), do: %{}

  defp build_legacy_comparison_expressions(shape) do
    {:ok, {_tags, comparison_expressions}} =
      Walker.reduce(
        shape.where.eval,
        fn
          %Eval.Parser.Func{name: "sublink_membership_check", args: [testexpr, sublink_ref]},
          {tags, comparison_expressions},
          _ ->
            {:ok, {tags, Map.put(comparison_expressions, sublink_ref.path, testexpr)}}

          _, acc, _ ->
            {:ok, acc}
        end,
        {[], %{}}
      )

    Map.new(comparison_expressions, fn {path, expr} ->
      {path, Eval.Expr.wrap_parser_part(expr)}
    end)
  end
end
