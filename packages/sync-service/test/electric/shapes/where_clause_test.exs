defmodule Electric.Shapes.WhereClauseTest do
  use ExUnit.Case, async: true

  alias Electric.Shapes.WhereClause
  alias Electric.Replication.Eval.Parser.{Func, Ref, Const}

  describe "compute_active_conditions/4" do
    test "returns empty list for nil decomposition" do
      assert {:ok, []} = WhereClause.compute_active_conditions(nil, %{}, %{}, %{})
    end

    test "returns empty list for decomposition with no positions" do
      decomposition = %{
        position_count: 0,
        subexpressions: %{}
      }

      assert {:ok, []} = WhereClause.compute_active_conditions(decomposition, %{}, %{}, %{})
    end

    test "evaluates single positive condition with proper implementation" do
      # x = 1 with proper implementation
      ast = %Func{
        name: "=",
        args: [%Ref{path: ["x"], type: :int4}, %Const{value: 1, type: :int4}],
        type: :bool,
        implementation: &Kernel.==/2,
        strict?: true
      }

      decomposition = %{
        position_count: 1,
        subexpressions: %{
          0 => %{ast: ast, is_subquery: false, column: "x", negated: false}
        },
        disjuncts: [[{0, :positive}]],
        has_subqueries: false
      }

      # When x = 1, condition is true
      assert {:ok, [true]} =
               WhereClause.compute_active_conditions(
                 decomposition,
                 %{"x" => "1"},
                 %{},
                 %{["x"] => :int4}
               )

      # When x = 2, condition is false
      assert {:ok, [false]} =
               WhereClause.compute_active_conditions(
                 decomposition,
                 %{"x" => "2"},
                 %{},
                 %{["x"] => :int4}
               )
    end

    test "evaluates multiple conditions with AND" do
      # x = 1 AND y = 2 with proper implementations
      ast1 = %Func{
        name: "=",
        args: [%Ref{path: ["x"], type: :int4}, %Const{value: 1, type: :int4}],
        type: :bool,
        implementation: &Kernel.==/2,
        strict?: true
      }

      ast2 = %Func{
        name: "=",
        args: [%Ref{path: ["y"], type: :int4}, %Const{value: 2, type: :int4}],
        type: :bool,
        implementation: &Kernel.==/2,
        strict?: true
      }

      decomposition = %{
        position_count: 2,
        subexpressions: %{
          0 => %{ast: ast1, is_subquery: false, column: "x", negated: false},
          1 => %{ast: ast2, is_subquery: false, column: "y", negated: false}
        },
        disjuncts: [[{0, :positive}, {1, :positive}]],
        has_subqueries: false
      }

      used_refs = %{["x"] => :int4, ["y"] => :int4}

      # Both conditions true
      assert {:ok, [true, true]} =
               WhereClause.compute_active_conditions(
                 decomposition,
                 %{"x" => "1", "y" => "2"},
                 %{},
                 used_refs
               )

      # First true, second false
      assert {:ok, [true, false]} =
               WhereClause.compute_active_conditions(
                 decomposition,
                 %{"x" => "1", "y" => "3"},
                 %{},
                 used_refs
               )

      # Both false
      assert {:ok, [false, false]} =
               WhereClause.compute_active_conditions(
                 decomposition,
                 %{"x" => "9", "y" => "9"},
                 %{},
                 used_refs
               )
    end
  end

  describe "evaluate_dnf/2" do
    test "empty conditions with empty disjuncts returns true" do
      assert WhereClause.evaluate_dnf([], [[]]) == true
    end

    test "single positive literal - true" do
      # [[{0, :positive}]] means position 0 must be true
      assert WhereClause.evaluate_dnf([true], [[{0, :positive}]]) == true
    end

    test "single positive literal - false" do
      assert WhereClause.evaluate_dnf([false], [[{0, :positive}]]) == false
    end

    test "single negated literal - true when value is false" do
      # [[{0, :negated}]] means position 0 must be false (NOT x)
      assert WhereClause.evaluate_dnf([false], [[{0, :negated}]]) == true
    end

    test "single negated literal - false when value is true" do
      assert WhereClause.evaluate_dnf([true], [[{0, :negated}]]) == false
    end

    test "AND (conjunction) - all must be true" do
      # [[{0, :positive}, {1, :positive}]] means x AND y
      assert WhereClause.evaluate_dnf([true, true], [[{0, :positive}, {1, :positive}]]) == true
      assert WhereClause.evaluate_dnf([true, false], [[{0, :positive}, {1, :positive}]]) == false
      assert WhereClause.evaluate_dnf([false, true], [[{0, :positive}, {1, :positive}]]) == false
      assert WhereClause.evaluate_dnf([false, false], [[{0, :positive}, {1, :positive}]]) == false
    end

    test "OR (disjunction) - at least one must be true" do
      # [[{0, :positive}], [{1, :positive}]] means x OR y
      disjuncts = [[{0, :positive}], [{1, :positive}]]
      assert WhereClause.evaluate_dnf([true, true], disjuncts) == true
      assert WhereClause.evaluate_dnf([true, false], disjuncts) == true
      assert WhereClause.evaluate_dnf([false, true], disjuncts) == true
      assert WhereClause.evaluate_dnf([false, false], disjuncts) == false
    end

    test "complex DNF - (A AND B) OR (C AND D)" do
      # [[{0, :positive}, {1, :positive}], [{2, :positive}, {3, :positive}]]
      disjuncts = [[{0, :positive}, {1, :positive}], [{2, :positive}, {3, :positive}]]

      # First conjunction satisfied
      assert WhereClause.evaluate_dnf([true, true, false, false], disjuncts) == true

      # Second conjunction satisfied
      assert WhereClause.evaluate_dnf([false, false, true, true], disjuncts) == true

      # Neither satisfied
      assert WhereClause.evaluate_dnf([true, false, true, false], disjuncts) == false
    end

    test "mixed polarity - (A AND NOT B) OR C" do
      # [[{0, :positive}, {1, :negated}], [{2, :positive}]]
      disjuncts = [[{0, :positive}, {1, :negated}], [{2, :positive}]]

      # First conjunction: A=true, NOT B=true (B=false)
      assert WhereClause.evaluate_dnf([true, false, false], disjuncts) == true

      # First conjunction fails because B is true
      assert WhereClause.evaluate_dnf([true, true, false], disjuncts) == false

      # Second disjunct: C=true
      assert WhereClause.evaluate_dnf([false, true, true], disjuncts) == true
    end
  end

  describe "satisfied_disjuncts/2" do
    test "returns empty list when no disjuncts satisfied" do
      disjuncts = [[{0, :positive}], [{1, :positive}]]
      assert WhereClause.satisfied_disjuncts([false, false], disjuncts) == []
    end

    test "returns indices of all satisfied disjuncts" do
      disjuncts = [[{0, :positive}], [{1, :positive}], [{2, :positive}]]
      assert WhereClause.satisfied_disjuncts([true, false, true], disjuncts) == [0, 2]
    end

    test "handles complex conjunctions" do
      # [[{0, :positive}, {1, :positive}], [{2, :positive}]]
      disjuncts = [[{0, :positive}, {1, :positive}], [{2, :positive}]]

      # Only second disjunct satisfied
      assert WhereClause.satisfied_disjuncts([true, false, true], disjuncts) == [1]

      # Both satisfied
      assert WhereClause.satisfied_disjuncts([true, true, true], disjuncts) == [0, 1]
    end
  end

  describe "evaluate_conjunction/2" do
    test "empty conjunction is true" do
      assert WhereClause.evaluate_conjunction([true, false], []) == true
    end

    test "single literal" do
      assert WhereClause.evaluate_conjunction([true], [{0, :positive}]) == true
      assert WhereClause.evaluate_conjunction([false], [{0, :positive}]) == false
    end

    test "multiple literals" do
      conjunction = [{0, :positive}, {1, :negated}]
      assert WhereClause.evaluate_conjunction([true, false], conjunction) == true
      assert WhereClause.evaluate_conjunction([true, true], conjunction) == false
      assert WhereClause.evaluate_conjunction([false, false], conjunction) == false
    end
  end
end
