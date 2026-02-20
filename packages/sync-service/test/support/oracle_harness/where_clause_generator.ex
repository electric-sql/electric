defmodule Support.OracleHarness.WhereClauseGenerator do
  @moduledoc """
  StreamData-based generator for WHERE clauses.
  Generates diverse SQL patterns for oracle testing including:
  - AND/OR combinations with subqueries
  - NOT patterns (NOT IN, NOT LIKE, NOT BETWEEN)
  - Comparison operators (<, >, <=, >=, <>)
  - BETWEEN/NOT BETWEEN
  - LIKE/NOT LIKE with various patterns
  - Nested subqueries (1-3 levels)
  - Tag-based subqueries
  - Mixed compositions
  """

  import StreamData

  # Schema constants (match standard_schema.ex)
  @level_1_ids Enum.map(1..5, &"l1-#{&1}")
  @level_2_ids Enum.map(1..5, &"l2-#{&1}")
  @level_3_ids Enum.map(1..5, &"l3-#{&1}")
  @level_4_ids Enum.map(1..20, &"l4-#{&1}")
  @tags ["alpha", "beta", "gamma", "delta"]

  # ============================================================================
  # Main Entry Points
  # ============================================================================

  @doc """
  Returns a StreamData generator that produces {where_clause, optimized?} tuples.

  Options:
    - :max_depth - Maximum nesting depth for compositions (default: 2)
  """
  def where_clause_gen(opts \\ []) do
    max_depth = Keyword.get(opts, :max_depth, 2)

    frequency([
      {4, atomic_with_meta()},
      {3, subquery_with_meta()},
      {2, and_composition(max_depth)},
      {2, or_composition(max_depth)},
      {1, complex_composition(max_depth)}
    ])
  end

  @doc """
  Generates a list of shape specs using StreamData.

  Uses the provided seed for deterministic generation.
  Returns list of maps with :where and :optimized keys.
  """
  def generate_where_clauses(count, seed) do
    # Seed the process dictionary so StreamData's Enum.take uses deterministic randomness
    :rand.seed(:exsss, seed)

    where_clause_gen()
    |> Enum.take(count * 3)
    |> Enum.uniq_by(fn {where, _optimized} -> where end)
    |> Enum.take(count)
    |> Enum.shuffle()
    |> Enum.map(fn {where, _optimized} ->
      %{where: where, optimized: true}
    end)
  end

  # ============================================================================
  # Value Generators
  # ============================================================================

  defp level_1_id_gen, do: member_of(@level_1_ids)
  defp level_2_id_gen, do: member_of(@level_2_ids)
  defp level_3_id_gen, do: member_of(@level_3_ids)
  defp level_4_id_gen, do: member_of(@level_4_ids)
  defp bool_gen, do: member_of(["true", "false"])
  defp tag_gen, do: member_of(@tags)

  # Value patterns for level_4.value column
  defp value_literal_gen do
    member_of(["v0", "v1", "v5", "v10", "v15", "v19"])
  end

  defp like_pattern_gen do
    member_of(["v%", "v1%", "v_", "%5", "%1%"])
  end

  # ============================================================================
  # Atomic Condition Generators (Base Predicates)
  # ============================================================================

  defp atomic_with_meta do
    frequency([
      {3, equality_gen()},
      {2, comparison_gen()},
      {2, like_gen()},
      {1, between_gen()},
      {2, in_values_gen()}
    ])
  end

  # col = 'val'
  defp equality_gen do
    one_of([
      # level_3_id = 'l3-X'
      level_3_id_gen() |> map(&{"level_3_id = '#{&1}'", false}),
      # id = 'l4-X'
      level_4_id_gen() |> map(&{"id = '#{&1}'", false}),
      # value = 'vX'
      value_literal_gen() |> map(&{"value = '#{&1}'", false})
    ])
  end

  # col > 'val', col <> 'val', etc.
  defp comparison_gen do
    bind({member_of(["<", ">", "<=", ">=", "<>"]), value_literal_gen()}, fn {op, val} ->
      constant({"value #{op} '#{val}'", false})
    end)
  end

  # col LIKE 'pattern' / col NOT LIKE 'pattern'
  defp like_gen do
    bind({member_of([{"LIKE", false}, {"NOT LIKE", false}]), like_pattern_gen()}, fn
      {{op, optimized}, pattern} ->
        constant({"value #{op} '#{pattern}'", optimized})
    end)
  end

  # col BETWEEN 'a' AND 'b' / col NOT BETWEEN 'a' AND 'b'
  defp between_gen do
    bind(
      {member_of([{"BETWEEN", false}, {"NOT BETWEEN", false}]), value_literal_gen(),
       value_literal_gen()},
      fn {{op, optimized}, v1, v2} ->
        # Ensure v1 <= v2 for valid BETWEEN
        {low, high} = if v1 <= v2, do: {v1, v2}, else: {v2, v1}
        constant({"value #{op} '#{low}' AND '#{high}'", optimized})
      end
    )
  end

  # col IN ('a', 'b', 'c')
  defp in_values_gen do
    one_of([
      # level_3_id IN ('l3-1', 'l3-2', ...)
      bind(list_of(level_3_id_gen(), min_length: 2, max_length: 4), fn ids ->
        values = ids |> Enum.uniq() |> Enum.map(&"'#{&1}'") |> Enum.join(", ")
        constant({"level_3_id IN (#{values})", false})
      end),
      # id IN ('l4-1', 'l4-2', ...)
      bind(list_of(level_4_id_gen(), min_length: 2, max_length: 4), fn ids ->
        values = ids |> Enum.uniq() |> Enum.map(&"'#{&1}'") |> Enum.join(", ")
        constant({"id IN (#{values})", false})
      end)
    ])
  end

  # ============================================================================
  # Subquery Generators
  # ============================================================================

  defp subquery_with_meta do
    frequency([
      {3, subquery_1_level_gen()},
      {2, subquery_2_level_gen()},
      {1, subquery_3_level_gen()},
      {2, tag_subquery_gen()}
    ])
  end

  # 1-level subquery: level_3_id IN (SELECT id FROM level_3 WHERE ...)
  defp subquery_1_level_gen do
    one_of([
      # Filter by active flag
      bool_gen()
      |> map(fn active ->
        {"level_3_id IN (SELECT id FROM level_3 WHERE active = #{active})", false}
      end),
      # Filter by level_2_id
      level_2_id_gen()
      |> map(fn l2_id ->
        {"level_3_id IN (SELECT id FROM level_3 WHERE level_2_id = '#{l2_id}')", false}
      end)
    ])
  end

  # 2-level subquery
  defp subquery_2_level_gen do
    one_of([
      # Through active flags at both levels
      bind({bool_gen(), bool_gen()}, fn {active_l3, active_l2} ->
        constant(
          {"level_3_id IN (SELECT id FROM level_3 WHERE active = #{active_l3} AND level_2_id IN (SELECT id FROM level_2 WHERE active = #{active_l2}))",
           false}
        )
      end),
      # Through specific level_1_id
      level_1_id_gen()
      |> map(fn l1_id ->
        {"level_3_id IN (SELECT id FROM level_3 WHERE level_2_id IN (SELECT id FROM level_2 WHERE level_1_id = '#{l1_id}'))",
         false}
      end)
    ])
  end

  # 3-level subquery
  defp subquery_3_level_gen do
    bool_gen()
    |> map(fn active_l1 ->
      {"level_3_id IN (SELECT id FROM level_3 WHERE level_2_id IN (SELECT id FROM level_2 WHERE level_1_id IN (SELECT id FROM level_1 WHERE active = #{active_l1})))",
       false}
    end)
  end

  # Tag-based subqueries
  defp tag_subquery_gen do
    bind({tag_gen(), member_of([1, 2, 3])}, fn {tag, level} ->
      case level do
        1 ->
          constant(
            {"level_3_id IN (SELECT level_3_id FROM level_3_tags WHERE tag = '#{tag}')", false}
          )

        2 ->
          constant(
            {"level_3_id IN (SELECT id FROM level_3 WHERE level_2_id IN (SELECT level_2_id FROM level_2_tags WHERE tag = '#{tag}'))",
             false}
          )

        3 ->
          constant(
            {"level_3_id IN (SELECT id FROM level_3 WHERE level_2_id IN (SELECT id FROM level_2 WHERE level_1_id IN (SELECT level_1_id FROM level_1_tags WHERE tag = '#{tag}')))",
             false}
          )
      end
    end)
  end

  # ============================================================================
  # NOT Subquery Generators
  # ============================================================================

  defp not_in_subquery_gen do
    one_of([
      # NOT IN with active flag
      bool_gen()
      |> map(fn active ->
        {"level_3_id NOT IN (SELECT id FROM level_3 WHERE active = #{active})", false}
      end),
      # NOT IN with level_2_id
      level_2_id_gen()
      |> map(fn l2_id ->
        {"level_3_id NOT IN (SELECT id FROM level_3 WHERE level_2_id = '#{l2_id}')", false}
      end)
    ])
  end

  # ============================================================================
  # Composition Generators
  # ============================================================================

  # AND composition: expr AND expr
  defp and_composition(depth) when depth <= 0, do: atomic_with_meta()

  defp and_composition(depth) do
    bind({base_expr_gen(depth - 1), base_expr_gen(depth - 1)}, fn
      {{left, left_opt}, {right, right_opt}} ->
        has_left_subquery = contains_subquery?(left)
        has_right_subquery = contains_subquery?(right)

        # AND with multiple subqueries at same level is NOT optimized
        optimized = left_opt and right_opt and not (has_left_subquery and has_right_subquery)
        constant({"(#{left}) AND (#{right})", optimized})
    end)
  end

  # OR composition: expr OR expr
  defp or_composition(depth) when depth <= 0, do: atomic_with_meta()

  defp or_composition(depth) do
    bind({base_expr_gen(depth - 1), base_expr_gen(depth - 1)}, fn
      {{left, left_opt}, {right, right_opt}} ->
        # OR with subqueries is typically not optimized
        optimized =
          left_opt and right_opt and not contains_subquery?(left) and
            not contains_subquery?(right)

        constant({"(#{left}) OR (#{right})", optimized})
    end)
  end

  # Complex mixed compositions
  defp complex_composition(depth) when depth <= 0, do: atomic_with_meta()

  defp complex_composition(depth) do
    frequency([
      # (a OR b) AND c
      {2, and_or_composition(depth)},
      # NOT (condition)
      {1, not_composition(depth)},
      # a OR b OR c (multiple ORs)
      {1, multi_or_composition(depth)},
      # Subquery OR simple condition
      {2, subquery_or_simple(depth)}
    ])
  end

  defp and_or_composition(depth) do
    bind({or_composition(depth - 1), base_expr_gen(depth - 1)}, fn
      {{or_expr, or_opt}, {simple, simple_opt}} ->
        optimized = or_opt and simple_opt
        constant({"(#{or_expr}) AND (#{simple})", optimized})
    end)
  end

  defp not_composition(_depth) do
    one_of([
      # NOT (simple condition)
      atomic_with_meta() |> map(fn {expr, _} -> {"NOT (#{expr})", false} end),
      # NOT IN subquery
      not_in_subquery_gen()
    ])
  end

  defp multi_or_composition(depth) do
    bind(list_of(base_expr_gen(depth - 1), min_length: 2, max_length: 3), fn exprs ->
      clauses = Enum.map(exprs, fn {expr, _} -> "(#{expr})" end)
      combined = Enum.join(clauses, " OR ")
      # Multi-OR is generally not optimized
      constant({combined, false})
    end)
  end

  defp subquery_or_simple(_depth) do
    bind({subquery_1_level_gen(), atomic_with_meta()}, fn
      {{subq, _}, {simple, _}} ->
        # OR with subquery is not optimized
        constant({"(#{subq}) OR (#{simple})", false})
    end)
  end

  # Base expression generator for compositions
  defp base_expr_gen(depth) when depth <= 0 do
    frequency([
      {3, atomic_with_meta()},
      {1, subquery_1_level_gen()}
    ])
  end

  defp base_expr_gen(depth) do
    frequency([
      {4, atomic_with_meta()},
      {2, subquery_with_meta()},
      {1, and_composition(depth - 1)},
      {1, or_composition(depth - 1)}
    ])
  end

  # Helper to detect if expression contains a subquery
  defp contains_subquery?(expr), do: String.contains?(expr, "SELECT")
end
