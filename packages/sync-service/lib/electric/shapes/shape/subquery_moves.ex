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
          Enum.map(
            gone_values,
            &%{pos: 0, value: make_value_hash(stack_id, shape_handle, elem(&1, 1))}
          )

        {:hash_together, columns} ->
          column_parts =
            &(Enum.zip_with(&1, columns, fn value, column ->
                column <> ":" <> namespace_value(value)
              end)
              |> Enum.join())

          Enum.map(
            gone_values,
            &%{
              pos: 0,
              value:
                make_value_hash_raw(
                  stack_id,
                  shape_handle,
                  column_parts.(Tuple.to_list(elem(&1, 1)))
                )
            }
          )
      end
    end)
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
