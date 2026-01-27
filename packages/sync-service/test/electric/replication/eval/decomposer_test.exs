defmodule Electric.Replication.Eval.DecomposerTest do
  use ExUnit.Case, async: true

  alias Electric.Replication.Eval.Decomposer
  alias Electric.Replication.Eval.Parser.{Func, Ref, Const}

  describe "decompose/1" do
    test "handles nil AST" do
      assert {:ok, %{disjuncts: [[]], subexpressions: %{}, position_count: 0}} =
               Decomposer.decompose(nil)
    end

    test "simple positive literal" do
      # x = 1
      ast = %Func{
        name: "=",
        args: [%Ref{path: ["x"], type: :int4}, %Const{value: 1, type: :int4}],
        type: :bool
      }

      assert {:ok, decomposition} = Decomposer.decompose(ast)
      assert decomposition.position_count == 1
      assert decomposition.disjuncts == [[{0, :positive}]]
      assert decomposition.subexpressions[0].negated == false
    end

    test "simple AND - single conjunction" do
      # x = 1 AND y = 2
      ast = %Func{
        name: "and",
        args: [
          %Func{
            name: "=",
            args: [%Ref{path: ["x"], type: :int4}, %Const{value: 1, type: :int4}],
            type: :bool
          },
          %Func{
            name: "=",
            args: [%Ref{path: ["y"], type: :int4}, %Const{value: 2, type: :int4}],
            type: :bool
          }
        ],
        type: :bool
      }

      assert {:ok, decomposition} = Decomposer.decompose(ast)
      assert decomposition.position_count == 2

      # Single disjunct with two literals
      assert length(decomposition.disjuncts) == 1
      [conjunction] = decomposition.disjuncts
      assert length(conjunction) == 2
      assert Enum.all?(conjunction, fn {_pos, polarity} -> polarity == :positive end)
    end

    test "simple OR - multiple disjuncts" do
      # x = 1 OR y = 2
      ast = %Func{
        name: "or",
        args: [
          %Func{
            name: "=",
            args: [%Ref{path: ["x"], type: :int4}, %Const{value: 1, type: :int4}],
            type: :bool
          },
          %Func{
            name: "=",
            args: [%Ref{path: ["y"], type: :int4}, %Const{value: 2, type: :int4}],
            type: :bool
          }
        ],
        type: :bool
      }

      assert {:ok, decomposition} = Decomposer.decompose(ast)
      assert decomposition.position_count == 2

      # Two disjuncts, each with one literal
      assert length(decomposition.disjuncts) == 2
      assert Enum.all?(decomposition.disjuncts, fn conj -> length(conj) == 1 end)
    end

    test "NOT with literal" do
      # NOT (x = 1)
      ast = %Func{
        name: "not",
        args: [
          %Func{
            name: "=",
            args: [%Ref{path: ["x"], type: :int4}, %Const{value: 1, type: :int4}],
            type: :bool
          }
        ],
        type: :bool
      }

      assert {:ok, decomposition} = Decomposer.decompose(ast)
      assert decomposition.position_count == 1
      assert decomposition.disjuncts == [[{0, :negated}]]
      assert decomposition.subexpressions[0].negated == true
    end

    test "De Morgan's law - NOT (A AND B) becomes (NOT A) OR (NOT B)" do
      # NOT (x = 1 AND y = 2) => (NOT x = 1) OR (NOT y = 2)
      ast = %Func{
        name: "not",
        args: [
          %Func{
            name: "and",
            args: [
              %Func{
                name: "=",
                args: [%Ref{path: ["x"], type: :int4}, %Const{value: 1, type: :int4}],
                type: :bool
              },
              %Func{
                name: "=",
                args: [%Ref{path: ["y"], type: :int4}, %Const{value: 2, type: :int4}],
                type: :bool
              }
            ],
            type: :bool
          }
        ],
        type: :bool
      }

      assert {:ok, decomposition} = Decomposer.decompose(ast)
      assert decomposition.position_count == 2

      # Two disjuncts, each with one negated literal
      assert length(decomposition.disjuncts) == 2

      assert Enum.all?(decomposition.disjuncts, fn conj ->
               length(conj) == 1 and match?([{_, :negated}], conj)
             end)
    end

    test "De Morgan's law - NOT (A OR B) becomes (NOT A) AND (NOT B)" do
      # NOT (x = 1 OR y = 2) => (NOT x = 1) AND (NOT y = 2)
      ast = %Func{
        name: "not",
        args: [
          %Func{
            name: "or",
            args: [
              %Func{
                name: "=",
                args: [%Ref{path: ["x"], type: :int4}, %Const{value: 1, type: :int4}],
                type: :bool
              },
              %Func{
                name: "=",
                args: [%Ref{path: ["y"], type: :int4}, %Const{value: 2, type: :int4}],
                type: :bool
              }
            ],
            type: :bool
          }
        ],
        type: :bool
      }

      assert {:ok, decomposition} = Decomposer.decompose(ast)
      assert decomposition.position_count == 2

      # One disjunct with two negated literals (conjunction of negations)
      assert length(decomposition.disjuncts) == 1
      [conjunction] = decomposition.disjuncts
      assert length(conjunction) == 2
      assert Enum.all?(conjunction, fn {_pos, polarity} -> polarity == :negated end)
    end

    test "nested NOT - double negation elimination" do
      # NOT NOT (x = 1) => x = 1
      ast = %Func{
        name: "not",
        args: [
          %Func{
            name: "not",
            args: [
              %Func{
                name: "=",
                args: [%Ref{path: ["x"], type: :int4}, %Const{value: 1, type: :int4}],
                type: :bool
              }
            ],
            type: :bool
          }
        ],
        type: :bool
      }

      assert {:ok, decomposition} = Decomposer.decompose(ast)
      assert decomposition.position_count == 1
      # Double negation is eliminated, so the literal is positive
      assert decomposition.disjuncts == [[{0, :positive}]]
    end

    test "distribution - (A AND B) OR C" do
      # (x = 1 AND y = 2) OR z = 3
      # Already in DNF: [[{0}, {1}], [{2}]]
      ast = %Func{
        name: "or",
        args: [
          %Func{
            name: "and",
            args: [
              %Func{
                name: "=",
                args: [%Ref{path: ["x"], type: :int4}, %Const{value: 1, type: :int4}],
                type: :bool
              },
              %Func{
                name: "=",
                args: [%Ref{path: ["y"], type: :int4}, %Const{value: 2, type: :int4}],
                type: :bool
              }
            ],
            type: :bool
          },
          %Func{
            name: "=",
            args: [%Ref{path: ["z"], type: :int4}, %Const{value: 3, type: :int4}],
            type: :bool
          }
        ],
        type: :bool
      }

      assert {:ok, decomposition} = Decomposer.decompose(ast)
      assert decomposition.position_count == 3
      # Two disjuncts: first with 2 literals, second with 1
      assert length(decomposition.disjuncts) == 2
    end

    test "distribution - A AND (B OR C) becomes (A AND B) OR (A AND C)" do
      # x = 1 AND (y = 2 OR z = 3)
      # DNF: (x = 1 AND y = 2) OR (x = 1 AND z = 3)
      ast = %Func{
        name: "and",
        args: [
          %Func{
            name: "=",
            args: [%Ref{path: ["x"], type: :int4}, %Const{value: 1, type: :int4}],
            type: :bool
          },
          %Func{
            name: "or",
            args: [
              %Func{
                name: "=",
                args: [%Ref{path: ["y"], type: :int4}, %Const{value: 2, type: :int4}],
                type: :bool
              },
              %Func{
                name: "=",
                args: [%Ref{path: ["z"], type: :int4}, %Const{value: 3, type: :int4}],
                type: :bool
              }
            ],
            type: :bool
          }
        ],
        type: :bool
      }

      assert {:ok, decomposition} = Decomposer.decompose(ast)
      assert decomposition.position_count == 3
      # Two disjuncts, each with 2 literals
      assert length(decomposition.disjuncts) == 2
      assert Enum.all?(decomposition.disjuncts, fn conj -> length(conj) == 2 end)
    end

    test "subquery detection" do
      # x IN (SELECT ...) - represented as sublink_membership_check
      ast = %Func{
        name: "sublink_membership_check",
        args: [
          %Ref{path: ["x"], type: :text},
          {:sublink_ref, 0}
        ],
        type: :bool
      }

      assert {:ok, decomposition} = Decomposer.decompose(ast)
      assert decomposition.has_subqueries == true
      assert decomposition.subexpressions[0].is_subquery == true
      assert decomposition.subexpressions[0].column == "x"
    end

    test "mixed subquery and field condition" do
      # x IN subquery AND status = 'active'
      ast = %Func{
        name: "and",
        args: [
          %Func{
            name: "sublink_membership_check",
            args: [
              %Ref{path: ["x"], type: :text},
              {:sublink_ref, 0}
            ],
            type: :bool
          },
          %Func{
            name: "=",
            args: [%Ref{path: ["status"], type: :text}, %Const{value: "active", type: :text}],
            type: :bool
          }
        ],
        type: :bool
      }

      assert {:ok, decomposition} = Decomposer.decompose(ast)
      assert decomposition.has_subqueries == true
      assert decomposition.position_count == 2

      # One disjunct with two literals
      assert length(decomposition.disjuncts) == 1
      [conjunction] = decomposition.disjuncts
      assert length(conjunction) == 2
    end

    test "OR with subqueries" do
      # x IN sq1 OR y IN sq2
      ast = %Func{
        name: "or",
        args: [
          %Func{
            name: "sublink_membership_check",
            args: [%Ref{path: ["x"], type: :text}, {:sublink_ref, 0}],
            type: :bool
          },
          %Func{
            name: "sublink_membership_check",
            args: [%Ref{path: ["y"], type: :text}, {:sublink_ref, 1}],
            type: :bool
          }
        ],
        type: :bool
      }

      assert {:ok, decomposition} = Decomposer.decompose(ast)
      assert decomposition.has_subqueries == true
      assert decomposition.position_count == 2

      # Two disjuncts, each with one subquery
      assert length(decomposition.disjuncts) == 2

      subquery_positions =
        decomposition.subexpressions
        |> Enum.filter(fn {_k, v} -> v.is_subquery end)
        |> length()

      assert subquery_positions == 2
    end
  end

  describe "complex_expression?/1" do
    test "simple AND is not complex" do
      ast = %Func{
        name: "and",
        args: [
          %Func{
            name: "sublink_membership_check",
            args: [%Ref{path: ["x"], type: :text}, {:sublink_ref, 0}],
            type: :bool
          },
          %Func{
            name: "=",
            args: [%Ref{path: ["y"], type: :int4}, %Const{value: 1, type: :int4}],
            type: :bool
          }
        ],
        type: :bool
      }

      refute Decomposer.complex_expression?(ast)
    end

    test "OR with subqueries is complex" do
      ast = %Func{
        name: "or",
        args: [
          %Func{
            name: "sublink_membership_check",
            args: [%Ref{path: ["x"], type: :text}, {:sublink_ref, 0}],
            type: :bool
          },
          %Func{
            name: "sublink_membership_check",
            args: [%Ref{path: ["y"], type: :text}, {:sublink_ref, 1}],
            type: :bool
          }
        ],
        type: :bool
      }

      assert Decomposer.complex_expression?(ast)
    end

    test "NOT with subquery is complex" do
      ast = %Func{
        name: "not",
        args: [
          %Func{
            name: "sublink_membership_check",
            args: [%Ref{path: ["x"], type: :text}, {:sublink_ref, 0}],
            type: :bool
          }
        ],
        type: :bool
      }

      assert Decomposer.complex_expression?(ast)
    end

    test "OR without subqueries is not complex" do
      ast = %Func{
        name: "or",
        args: [
          %Func{
            name: "=",
            args: [%Ref{path: ["x"], type: :int4}, %Const{value: 1, type: :int4}],
            type: :bool
          },
          %Func{
            name: "=",
            args: [%Ref{path: ["y"], type: :int4}, %Const{value: 2, type: :int4}],
            type: :bool
          }
        ],
        type: :bool
      }

      refute Decomposer.complex_expression?(ast)
    end
  end
end
