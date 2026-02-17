defmodule Electric.Replication.Eval.DecomposerTest do
  use ExUnit.Case, async: true

  alias Electric.Replication.Eval.Parser
  alias Electric.Replication.Eval.SqlGenerator
  alias Electric.Replication.Eval.Decomposer

  @refs %{
    ["a"] => :int4,
    ["b"] => :int4,
    ["c"] => :int4,
    ["d"] => :int4,
    ["e"] => :int4,
    ["f"] => :int4,
    ["g"] => :int4,
    ["name"] => :text
  }

  describe "decompose/1" do
    test "should decompose a DNF query with shared subexpressions" do
      # (a = 1 AND b = 2) OR (c = 3 AND d = 4) OR (a = 1 AND c = 3)
      # Disjunct 1: positions 0-1
      # Disjunct 2: positions 2-3
      # Disjunct 3: positions 4-5 (reuses r1 for a=1, r3 for c=3)
      ~S"(a = 1 AND b = 2) OR (c = 3 AND d = 4) OR (a = 1 AND c = 3)"
      |> prepare()
      |> Decomposer.decompose()
      |> assert_expanded_dnf(
        expected_disjuncts: [
          [~s|"a" = 1|, ~s|"b" = 2|, nil, nil, nil, nil],
          [nil, nil, ~s|"c" = 3|, ~s|"d" = 4|, nil, nil],
          [nil, nil, nil, nil, ~s|"a" = 1|, ~s|"c" = 3|]
        ],
        expected_subexpressions: [~s|"a" = 1|, ~s|"b" = 2|, ~s|"c" = 3|, ~s|"d" = 4|]
      )
    end

    test "should handle a single comparison without AND/OR" do
      ~S"a = 1"
      |> prepare()
      |> Decomposer.decompose()
      |> assert_expanded_dnf(
        expected_disjuncts: [[~s|"a" = 1|]],
        expected_subexpressions: [~s|"a" = 1|]
      )
    end

    test "should handle all ANDs as a single disjunct" do
      ~S"a = 1 AND b = 2 AND c = 3"
      |> prepare()
      |> Decomposer.decompose()
      |> assert_expanded_dnf(
        expected_disjuncts: [[~s|"a" = 1|, ~s|"b" = 2|, ~s|"c" = 3|]],
        expected_subexpressions: [~s|"a" = 1|, ~s|"b" = 2|, ~s|"c" = 3|]
      )
    end

    test "should handle all ORs as N disjuncts with 1 expression each" do
      # a = 1 OR b = 2 OR c = 3
      # Each OR branch is its own disjunct with 1 expression
      # Total positions: 3 (one per disjunct)
      ~S"a = 1 OR b = 2 OR c = 3"
      |> prepare()
      |> Decomposer.decompose()
      |> assert_expanded_dnf(
        expected_disjuncts: [
          [~s|"a" = 1|, nil, nil],
          [nil, ~s|"b" = 2|, nil],
          [nil, nil, ~s|"c" = 3|]
        ],
        expected_subexpressions: [~s|"a" = 1|, ~s|"b" = 2|, ~s|"c" = 3|]
      )
    end

    test "should distribute AND over OR with subexpression reuse" do
      # a = 1 AND (b = 2 OR c = 3) => (a = 1 AND b = 2) OR (a = 1 AND c = 3)
      # After distribution, we get 2 disjuncts with 2 expressions each
      # The "a = 1" subexpression should be deduplicated (same reference)
      ~S"a = 1 AND (b = 2 OR c = 3)"
      |> prepare()
      |> Decomposer.decompose()
      |> assert_expanded_dnf(
        expected_disjuncts: [
          [~s|"a" = 1|, ~s|"b" = 2|, nil, nil],
          [nil, nil, ~s|"a" = 1|, ~s|"c" = 3|]
        ],
        expected_subexpressions: [~s|"a" = 1|, ~s|"b" = 2|, ~s|"c" = 3|]
      )
    end

    test "should handle subquery expressions as atomic subexpressions" do
      ~S"a = 1 AND (b IN (SELECT id FROM test_table) OR c = 3)"
      |> prepare_with_sublinks(
        %{["$sublink", "0"] => {:array, :int4}},
        %{0 => "SELECT id FROM test_table"}
      )
      |> Decomposer.decompose()
      |> assert_expanded_dnf(
        expected_disjuncts: [
          [~s|"a" = 1|, ~s|"b" IN (SELECT $sublink.0)|, nil, nil],
          [nil, nil, ~s|"a" = 1|, ~s|"c" = 3|]
        ],
        expected_subexpressions: [
          ~s|"a" = 1|,
          ~s|"b" IN (SELECT $sublink.0)|,
          ~s|"c" = 3|
        ]
      )
    end

    test "should handle deeply nested distribution ((a OR b) AND (c OR d))" do
      # (a OR b) AND (c OR d) => (a AND c) OR (a AND d) OR (b AND c) OR (b AND d)
      # 4 disjuncts, each with 2 expressions
      ~S"(a = 1 OR b = 2) AND (c = 3 OR d = 4)"
      |> prepare()
      |> Decomposer.decompose()
      |> assert_expanded_dnf(
        expected_disjuncts: [
          [~s|"a" = 1|, ~s|"c" = 3|, nil, nil, nil, nil, nil, nil],
          [nil, nil, ~s|"a" = 1|, ~s|"d" = 4|, nil, nil, nil, nil],
          [nil, nil, nil, nil, ~s|"b" = 2|, ~s|"c" = 3|, nil, nil],
          [nil, nil, nil, nil, nil, nil, ~s|"b" = 2|, ~s|"d" = 4|]
        ],
        expected_subexpressions: [~s|"a" = 1|, ~s|"b" = 2|, ~s|"c" = 3|, ~s|"d" = 4|]
      )
    end

    test "should push NOT down to leaf expressions" do
      # NOT a = 1 AND b = 2 parses as (NOT a = 1) AND b = 2
      # The NOT is already at the leaf, so it becomes {:not, ref}
      ~S"NOT a = 1 AND b = 2"
      |> prepare()
      |> Decomposer.decompose()
      |> assert_expanded_dnf(
        expected_disjuncts: [[{:not, ~s|"a" = 1|}, ~s|"b" = 2|]],
        expected_subexpressions: [~s|"a" = 1|, ~s|"b" = 2|]
      )
    end

    test "should apply De Morgan's law for NOT over OR" do
      # NOT (a = 1 OR b = 2) => (NOT a = 1) AND (NOT b = 2)
      # Single disjunct with two negated terms
      ~S"NOT (a = 1 OR b = 2)"
      |> prepare()
      |> Decomposer.decompose()
      |> assert_expanded_dnf(
        expected_disjuncts: [[{:not, ~s|"a" = 1|}, {:not, ~s|"b" = 2|}]],
        expected_subexpressions: [~s|"a" = 1|, ~s|"b" = 2|]
      )
    end

    test "should apply De Morgan's law for NOT over AND" do
      # NOT (a = 1 AND b = 2) => (NOT a = 1) OR (NOT b = 2)
      # Two disjuncts, each with one negated term
      ~S"NOT (a = 1 AND b = 2)"
      |> prepare()
      |> Decomposer.decompose()
      |> assert_expanded_dnf(
        expected_disjuncts: [
          [{:not, ~s|"a" = 1|}, nil],
          [nil, {:not, ~s|"b" = 2|}]
        ],
        expected_subexpressions: [~s|"a" = 1|, ~s|"b" = 2|]
      )
    end

    test "should handle double negation" do
      # NOT NOT a = 1 => a = 1 (double negation elimination)
      ~S"NOT NOT a = 1"
      |> prepare()
      |> Decomposer.decompose()
      |> assert_expanded_dnf(
        expected_disjuncts: [[~s|"a" = 1|]],
        expected_subexpressions: [~s|"a" = 1|]
      )
    end

    test "should handle function calls as atomic subexpressions" do
      ~S"lower(name) = 'test' OR upper(name) = 'TEST'"
      |> prepare()
      |> Decomposer.decompose()
      |> assert_expanded_dnf(
        expected_disjuncts: [
          [~s|lower("name") = 'test'|, nil],
          [nil, ~s|upper("name") = 'TEST'|]
        ],
        expected_subexpressions: [~s|lower("name") = 'test'|, ~s|upper("name") = 'TEST'|]
      )
    end

    test "should handle mixed-width disjuncts (multi-term AND with single-term OR)" do
      # (a = 1 AND b = 2 AND c = 3) OR d = 4
      # Disjunct 1 has 3 terms, disjunct 2 has 1 term, total width = 4
      ~S"(a = 1 AND b = 2 AND c = 3) OR d = 4"
      |> prepare()
      |> Decomposer.decompose()
      |> assert_expanded_dnf(
        expected_disjuncts: [
          [~s|"a" = 1|, ~s|"b" = 2|, ~s|"c" = 3|, nil],
          [nil, nil, nil, ~s|"d" = 4|]
        ],
        expected_subexpressions: [~s|"a" = 1|, ~s|"b" = 2|, ~s|"c" = 3|, ~s|"d" = 4|]
      )
    end

    test "should combine De Morgan with distribution" do
      # NOT (a = 1 AND b = 2) AND c = 3
      # De Morgan: NOT(AND(a,b)) => OR(NOT a, NOT b)
      # Then: AND(OR(NOT a, NOT b), c) distributes to:
      #   (NOT a AND c) OR (NOT b AND c)
      ~S"NOT (a = 1 AND b = 2) AND c = 3"
      |> prepare()
      |> Decomposer.decompose()
      |> assert_expanded_dnf(
        expected_disjuncts: [
          [{:not, ~s|"a" = 1|}, ~s|"c" = 3|, nil, nil],
          [nil, nil, {:not, ~s|"b" = 2|}, ~s|"c" = 3|]
        ],
        expected_subexpressions: [~s|"a" = 1|, ~s|"b" = 2|, ~s|"c" = 3|]
      )
    end

    test "should apply De Morgan recursively over nested AND within OR" do
      # NOT ((a = 1 AND b = 2) OR c = 3)
      # De Morgan over OR: AND(NOT(AND(a,b)), NOT c)
      # Inner De Morgan over AND: NOT(AND(a,b)) => OR(NOT a, NOT b)
      # Distribution: AND(OR(NOT a, NOT b), NOT c) =>
      #   (NOT a AND NOT c) OR (NOT b AND NOT c)
      ~S"NOT ((a = 1 AND b = 2) OR c = 3)"
      |> prepare()
      |> Decomposer.decompose()
      |> assert_expanded_dnf(
        expected_disjuncts: [
          [{:not, ~s|"a" = 1|}, {:not, ~s|"c" = 3|}, nil, nil],
          [nil, nil, {:not, ~s|"b" = 2|}, {:not, ~s|"c" = 3|}]
        ],
        expected_subexpressions: [~s|"a" = 1|, ~s|"b" = 2|, ~s|"c" = 3|]
      )
    end

    test "should handle double cross-product with deduplication" do
      # ((a AND b) OR (c AND d)) AND ((d AND e) OR (f AND g))
      # Left OR:  2 disjuncts [ab, cd]
      # Right OR: 2 disjuncts [de, fg]
      # Cross-product: 2 × 2 = 4 disjuncts, each with 4 terms, expanded to width 16
      # d = 4 appears in left's 2nd disjunct AND right's 1st disjunct — shared ref
      {:ok, decomposition} =
        ~S"((a = 1 AND b = 2) OR (c = 3 AND d = 4)) AND ((d = 4 AND e = 5) OR (f = 6 AND g = 7))"
        |> prepare()
        |> Decomposer.decompose()

      assert_expanded_dnf({:ok, decomposition},
        expected_disjuncts: [
          # ab × de
          [~s|"a" = 1|, ~s|"b" = 2|, ~s|"d" = 4|, ~s|"e" = 5|,
           nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil],
          # ab × fg
          [nil, nil, nil, nil, ~s|"a" = 1|, ~s|"b" = 2|, ~s|"f" = 6|, ~s|"g" = 7|,
           nil, nil, nil, nil, nil, nil, nil, nil],
          # cd × de
          [nil, nil, nil, nil, nil, nil, nil, nil,
           ~s|"c" = 3|, ~s|"d" = 4|, ~s|"d" = 4|, ~s|"e" = 5|, nil, nil, nil, nil],
          # cd × fg
          [nil, nil, nil, nil, nil, nil, nil, nil,
           nil, nil, nil, nil, ~s|"c" = 3|, ~s|"d" = 4|, ~s|"f" = 6|, ~s|"g" = 7|]
        ],
        expected_subexpressions: [
          ~s|"a" = 1|, ~s|"b" = 2|, ~s|"c" = 3|, ~s|"d" = 4|,
          ~s|"e" = 5|, ~s|"f" = 6|, ~s|"g" = 7|
        ]
      )

      # Verify d = 4 appears at 4 positions (shared across disjuncts)
      d_eq_4_count =
        decomposition.subexpressions
        |> Enum.count(fn {_pos, subexpr} -> deparse(subexpr.ast) == ~s|"d" = 4| end)

      assert d_eq_4_count == 4
    end

    test "should share refs when same subexpression appears positive and negated" do
      # (a = 1 AND b = 2) OR (NOT a = 1 AND c = 3)
      # a = 1 appears positive in disjunct 1, negated in disjunct 2
      # The subexpressions map should have only 3 unique expressions
      {:ok, decomposition} =
        ~S"(a = 1 AND b = 2) OR (NOT a = 1 AND c = 3)"
        |> prepare()
        |> Decomposer.decompose()

      assert_expanded_dnf({:ok, decomposition},
        expected_disjuncts: [
          [~s|"a" = 1|, ~s|"b" = 2|, nil, nil],
          [nil, nil, {:not, ~s|"a" = 1|}, ~s|"c" = 3|]
        ],
        expected_subexpressions: [~s|"a" = 1|, ~s|"b" = 2|, ~s|"c" = 3|]
      )

      # Verify a = 1 appears at one positive and one negated position
      a_eq_1_entries =
        decomposition.subexpressions
        |> Enum.filter(fn {_pos, subexpr} -> deparse(subexpr.ast) == ~s|"a" = 1| end)

      assert length(a_eq_1_entries) == 2
      polarities = a_eq_1_entries |> Enum.map(fn {_, s} -> s.negated end) |> Enum.sort()
      assert polarities == [false, true]
    end

    test "should deduplicate references for identical subexpressions" do
      # All three disjuncts contain `a = 1` - should use same reference
      {:ok, decomposition} =
        ~S"(a = 1 AND b = 2) OR (a = 1 AND c = 3) OR a = 1"
        |> prepare()
        |> Decomposer.decompose()

      assert_expanded_dnf({:ok, decomposition},
        expected_disjuncts: [
          [~s|"a" = 1|, ~s|"b" = 2|, nil, nil, nil],
          [nil, nil, ~s|"a" = 1|, ~s|"c" = 3|, nil],
          [nil, nil, nil, nil, ~s|"a" = 1|]
        ],
        expected_subexpressions: [~s|"a" = 1|, ~s|"b" = 2|, ~s|"c" = 3|]
      )

      # a = 1 should appear at 3 positions (one per disjunct)
      a_eq_1_count =
        decomposition.subexpressions
        |> Enum.count(fn {_pos, subexpr} -> deparse(subexpr.ast) == ~s|"a" = 1| end)

      assert a_eq_1_count == 3
    end

    test "should return error when disjunct count exceeds limit" do
      # Build a WHERE clause with >100 disjuncts: a = 1 OR a = 2 OR ... OR a = 101
      clause = Enum.map_join(1..101, " OR ", &"a = #{&1}")

      result =
        clause
        |> prepare()
        |> Decomposer.decompose()

      assert {:error, message} = result
      assert message =~ "too complex"
      assert message =~ "101 disjuncts"
      assert message =~ "limit of 100"
    end
  end

  # Helper to prepare a WHERE clause string into a Parser AST
  defp prepare(where_clause) do
    {:ok, pgquery} = Parser.parse_query(where_clause)
    {:ok, expr} = Parser.validate_where_ast(pgquery, refs: @refs)
    expr.eval
  end

  # Helper for WHERE clauses containing subqueries (IN (SELECT ...))
  defp prepare_with_sublinks(where_clause, sublink_refs, sublink_queries) do
    {:ok, pgquery} = Parser.parse_query(where_clause)
    all_refs = Map.merge(@refs, sublink_refs)

    {:ok, expr} =
      Parser.validate_where_ast(pgquery, refs: all_refs, sublink_queries: sublink_queries)

    expr.eval
  end

  # Helper to deparse an AST node back to SQL string
  defp deparse(ast) do
    SqlGenerator.to_sql(ast)
  end

  # Assertion helper that verifies:
  # 1. Position count matches expected width
  # 2. Correct number of disjuncts
  # 3. Subexpressions map contains exactly the expected unique expressions
  # 4. Reconstructed expanded format matches expected disjuncts
  defp assert_expanded_dnf({:ok, decomposition}, opts) do
    expected_disjuncts = Keyword.fetch!(opts, :expected_disjuncts)
    expected_subexpressions = Keyword.fetch!(opts, :expected_subexpressions)

    %{
      disjuncts: disjuncts,
      subexpressions: subexpressions,
      position_count: position_count
    } = decomposition

    # 1. Verify position count matches expected width
    expected_width = expected_disjuncts |> hd() |> length()

    assert position_count == expected_width,
           "Position count (#{position_count}) must equal expected width (#{expected_width})"

    # 2. Verify correct number of disjuncts
    assert length(disjuncts) == length(expected_disjuncts),
           "Expected #{length(expected_disjuncts)} disjuncts, got #{length(disjuncts)}"

    # 3. Verify subexpressions map contains exactly the expected unique expressions
    actual_subexprs = subexpressions |> Map.values() |> Enum.map(&deparse(&1.ast)) |> MapSet.new()
    expected_subexprs = MapSet.new(expected_subexpressions)

    assert actual_subexprs == expected_subexprs,
           "Subexpressions mismatch. Expected: #{inspect(expected_subexprs)}, got: #{inspect(actual_subexprs)}"

    # 4. Reconstruct expanded format from sparse disjuncts for comparison
    actual_expanded =
      MapSet.new(disjuncts, fn conj ->
        row = List.duplicate(nil, position_count)

        Enum.reduce(conj, row, fn {pos, polarity}, row ->
          subexpr = Map.fetch!(subexpressions, pos)
          sql = deparse(subexpr.ast)
          term = if polarity == :negated, do: {:not, sql}, else: sql
          List.replace_at(row, pos, term)
        end)
      end)

    assert actual_expanded == MapSet.new(expected_disjuncts)
  end
end
