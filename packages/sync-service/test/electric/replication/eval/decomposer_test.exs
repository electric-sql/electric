defmodule Electric.Replication.Eval.DecomposerTest do
  use ExUnit.Case, async: true

  alias Electric.Replication.Eval.Parser
  alias Electric.Replication.Eval.Decomposer

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
          ["a = 1", "b = 2", nil, nil, nil, nil],
          [nil, nil, "c = 3", "d = 4", nil, nil],
          [nil, nil, nil, nil, "a = 1", "c = 3"]
        ],
        expected_subexpressions: ["a = 1", "b = 2", "c = 3", "d = 4"]
      )
    end

    test "should handle a single comparison without AND/OR" do
      ~S"a = 1"
      |> prepare()
      |> Decomposer.decompose()
      |> assert_expanded_dnf(
        expected_disjuncts: [["a = 1"]],
        expected_subexpressions: ["a = 1"]
      )
    end

    test "should handle all ANDs as a single disjunct" do
      ~S"a = 1 AND b = 2 AND c = 3"
      |> prepare()
      |> Decomposer.decompose()
      |> assert_expanded_dnf(
        expected_disjuncts: [["a = 1", "b = 2", "c = 3"]],
        expected_subexpressions: ["a = 1", "b = 2", "c = 3"]
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
          ["a = 1", nil, nil],
          [nil, "b = 2", nil],
          [nil, nil, "c = 3"]
        ],
        expected_subexpressions: ["a = 1", "b = 2", "c = 3"]
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
          ["a = 1", "b = 2", nil, nil],
          [nil, nil, "a = 1", "c = 3"]
        ],
        expected_subexpressions: ["a = 1", "b = 2", "c = 3"]
      )
    end

    test "should handle subquery expressions as atomic subexpressions" do
      ~S"a = 1 AND (b IN (SELECT id FROM test_table) OR c = 3)"
      |> prepare()
      |> Decomposer.decompose()
      |> assert_expanded_dnf(
        expected_disjuncts: [
          ["a = 1", "b IN (SELECT id FROM test_table)", nil, nil],
          [nil, nil, "a = 1", "c = 3"]
        ],
        expected_subexpressions: ["a = 1", "b IN (SELECT id FROM test_table)", "c = 3"]
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
          ["a = 1", "c = 3", nil, nil, nil, nil, nil, nil],
          [nil, nil, "a = 1", "d = 4", nil, nil, nil, nil],
          [nil, nil, nil, nil, "b = 2", "c = 3", nil, nil],
          [nil, nil, nil, nil, nil, nil, "b = 2", "d = 4"]
        ],
        expected_subexpressions: ["a = 1", "b = 2", "c = 3", "d = 4"]
      )
    end

    test "should push NOT down to leaf expressions" do
      # NOT a = 1 AND b = 2 parses as (NOT a = 1) AND b = 2
      # The NOT is already at the leaf, so it becomes {:not, ref}
      ~S"NOT a = 1 AND b = 2"
      |> prepare()
      |> Decomposer.decompose()
      |> assert_expanded_dnf(
        expected_disjuncts: [[{:not, "a = 1"}, "b = 2"]],
        expected_subexpressions: ["a = 1", "b = 2"]
      )
    end

    test "should apply De Morgan's law for NOT over OR" do
      # NOT (a = 1 OR b = 2) => (NOT a = 1) AND (NOT b = 2)
      # Single disjunct with two negated terms
      ~S"NOT (a = 1 OR b = 2)"
      |> prepare()
      |> Decomposer.decompose()
      |> assert_expanded_dnf(
        expected_disjuncts: [[{:not, "a = 1"}, {:not, "b = 2"}]],
        expected_subexpressions: ["a = 1", "b = 2"]
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
          [{:not, "a = 1"}, nil],
          [nil, {:not, "b = 2"}]
        ],
        expected_subexpressions: ["a = 1", "b = 2"]
      )
    end

    test "should handle double negation" do
      # NOT NOT a = 1 => a = 1 (double negation elimination)
      ~S"NOT NOT a = 1"
      |> prepare()
      |> Decomposer.decompose()
      |> assert_expanded_dnf(
        expected_disjuncts: [["a = 1"]],
        expected_subexpressions: ["a = 1"]
      )
    end

    test "should handle function calls as atomic subexpressions" do
      ~S"lower(name) = 'test' OR upper(name) = 'TEST'"
      |> prepare()
      |> Decomposer.decompose()
      |> assert_expanded_dnf(
        expected_disjuncts: [
          ["lower(name) = 'test'", nil],
          [nil, "upper(name) = 'TEST'"]
        ],
        expected_subexpressions: ["lower(name) = 'test'", "upper(name) = 'TEST'"]
      )
    end

    test "should deduplicate references for identical subexpressions" do
      # All three disjuncts contain `a = 1` - should use same reference
      {disjuncts, subexpressions} =
        ~S"(a = 1 AND b = 2) OR (a = 1 AND c = 3) OR a = 1"
        |> prepare()
        |> Decomposer.decompose()

      assert_expanded_dnf({disjuncts, subexpressions},
        expected_disjuncts: [
          ["a = 1", "b = 2", nil, nil, nil],
          [nil, nil, "a = 1", "c = 3", nil],
          [nil, nil, nil, nil, "a = 1"]
        ],
        expected_subexpressions: ["a = 1", "b = 2", "c = 3"]
      )

      # Additionally verify that a = 1 uses the same reference across disjuncts
      subexpressions_deparsed = Map.new(subexpressions, fn {ref, ast} -> {deparse(ast), ref} end)
      a_eq_1_ref = Map.fetch!(subexpressions_deparsed, "a = 1")

      # Find all occurrences of the a = 1 reference across disjuncts
      # Handle both plain refs and {:not, ref} tuples
      a_eq_1_positions =
        disjuncts
        |> Enum.with_index()
        |> Enum.flat_map(fn {conjuncts, disjunct_idx} ->
          conjuncts
          |> Enum.with_index()
          |> Enum.filter(fn {term, _pos} -> extract_ref(term) == a_eq_1_ref end)
          |> Enum.map(fn {_term, pos} -> {disjunct_idx, pos} end)
        end)

      # a = 1 should appear in all 3 disjuncts
      assert length(a_eq_1_positions) == 3
    end
  end

  # Helper to prepare a WHERE clause string into an AST
  defp prepare(where_clause) do
    {:ok, ast} = Parser.parse_query(where_clause)
    ast
  end

  # Helper to deparse an AST node back to SQL string
  defp deparse(ast) do
    %PgQuery.ParseResult{
      stmts: [
        %PgQuery.RawStmt{
          stmt: %PgQuery.Node{
            node:
              {:select_stmt,
               %PgQuery.SelectStmt{
                 target_list: [%PgQuery.Node{node: {:res_target, %PgQuery.ResTarget{val: ast}}}]
               }}
          }
        }
      ]
    }
    |> PgQuery.protobuf_to_query!()
    |> String.replace_prefix("SELECT ", "")
    |> String.trim()
  end

  # Assertion helper that verifies:
  # 1. All inner lists have the same length (expanded property)
  # 2. Each disjunct matches the expected structure (including nil positions)
  # 3. Subexpressions map contains exactly the expected unique expressions
  # 4. References are properly reused for identical subexpressions
  # 5. {:not, ref} terms are handled correctly
  defp assert_expanded_dnf({disjuncts, subexpressions}, opts) do
    expected_disjuncts = Keyword.fetch!(opts, :expected_disjuncts)
    expected_subexpressions = Keyword.fetch!(opts, :expected_subexpressions)

    # Convert subexpressions to deparsed form for comparison
    subexpressions_deparsed = Map.new(subexpressions, fn {ref, ast} -> {ref, deparse(ast)} end)

    # 1. Verify all disjuncts have the same length
    lengths = Enum.map(disjuncts, &length/1)
    assert lengths != [], "Disjuncts list cannot be empty"
    assert Enum.uniq(lengths) == [hd(lengths)], "All disjuncts must have same length"
    width = hd(lengths)

    # 2. Verify width matches expected disjuncts width
    expected_width = expected_disjuncts |> hd() |> length()

    assert width == expected_width,
           "Width (#{width}) must equal expected width (#{expected_width})"

    # 3. Verify correct number of disjuncts
    assert length(disjuncts) == length(expected_disjuncts),
           "Expected #{length(expected_disjuncts)} disjuncts, got #{length(disjuncts)}"

    # 4. Verify subexpressions map contains exactly the expected unique expressions
    assert length(expected_subexpressions) == map_size(subexpressions_deparsed),
           "Expected #{length(expected_subexpressions)} subexpressions, got #{map_size(subexpressions_deparsed)}"

    actual_subexprs = subexpressions_deparsed |> Map.values() |> MapSet.new()
    expected_subexprs = MapSet.new(expected_subexpressions)

    assert actual_subexprs == expected_subexprs,
           "Subexpressions mismatch. Expected: #{inspect(expected_subexprs)}, got: #{inspect(actual_subexprs)}"

    # 5. Verify each disjunct matches the expected structure
    expected = MapSet.new(expected_disjuncts)

    actual =
      MapSet.new(disjuncts, fn disjunct ->
        Enum.map(disjunct, &deparse_term(&1, subexpressions_deparsed))
      end)

    assert actual == expected
  end

  # Convert a DNF term (ref, {:not, ref}, or nil) to its expected format
  defp deparse_term(nil, _subexpressions_deparsed), do: nil

  defp deparse_term({:not, ref}, subexpressions_deparsed) do
    {:not, Map.fetch!(subexpressions_deparsed, ref)}
  end

  defp deparse_term(ref, subexpressions_deparsed) when is_reference(ref) do
    Map.fetch!(subexpressions_deparsed, ref)
  end

  # Extract the base reference from a DNF term
  defp extract_ref(nil), do: nil
  defp extract_ref({:not, ref}), do: ref
  defp extract_ref(ref) when is_reference(ref), do: ref
end
