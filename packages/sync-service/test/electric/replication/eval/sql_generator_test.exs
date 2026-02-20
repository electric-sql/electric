defmodule Electric.Replication.Eval.SqlGeneratorTest do
  use ExUnit.Case, async: true

  alias Electric.Replication.Eval.SqlGenerator
  alias Electric.Replication.Eval.Parser.{Const, Ref, Func, Array, RowExpr}

  describe "comparison operators" do
    test "equals" do
      ast = %Func{name: "\"=\"", args: [%Ref{path: ["status"]}, %Const{value: "active"}]}
      assert SqlGenerator.to_sql(ast) == ~s|"status" = 'active'|
    end

    test "not equals" do
      ast = %Func{name: "\"<>\"", args: [%Ref{path: ["x"]}, %Const{value: 1}]}
      assert SqlGenerator.to_sql(ast) == ~s|"x" <> 1|
    end

    test "less than" do
      ast = %Func{name: "\"<\"", args: [%Ref{path: ["age"]}, %Const{value: 30}]}
      assert SqlGenerator.to_sql(ast) == ~s|"age" < 30|
    end

    test "greater than" do
      ast = %Func{name: "\">\"", args: [%Ref{path: ["score"]}, %Const{value: 100}]}
      assert SqlGenerator.to_sql(ast) == ~s|"score" > 100|
    end

    test "less than or equal" do
      ast = %Func{name: "\"<=\"", args: [%Ref{path: ["x"]}, %Const{value: 5}]}
      assert SqlGenerator.to_sql(ast) == ~s|"x" <= 5|
    end

    test "greater than or equal" do
      ast = %Func{name: "\">=\"", args: [%Ref{path: ["y"]}, %Const{value: 10}]}
      assert SqlGenerator.to_sql(ast) == ~s|"y" >= 10|
    end
  end

  describe "pattern matching" do
    test "LIKE" do
      ast = %Func{name: "\"~~\"", args: [%Ref{path: ["name"]}, %Const{value: "%foo%"}]}
      assert SqlGenerator.to_sql(ast) == ~s|"name" LIKE '%foo%'|
    end

    test "ILIKE" do
      ast = %Func{name: "\"~~*\"", args: [%Ref{path: ["name"]}, %Const{value: "%bar%"}]}
      assert SqlGenerator.to_sql(ast) == ~s|"name" ILIKE '%bar%'|
    end

    test "NOT LIKE" do
      ast = %Func{name: "\"!~~\"", args: [%Ref{path: ["name"]}, %Const{value: "%baz%"}]}
      assert SqlGenerator.to_sql(ast) == ~s|"name" NOT LIKE '%baz%'|
    end

    test "NOT ILIKE" do
      ast = %Func{name: "\"!~~*\"", args: [%Ref{path: ["name"]}, %Const{value: "%qux%"}]}
      assert SqlGenerator.to_sql(ast) == ~s|"name" NOT ILIKE '%qux%'|
    end
  end

  describe "nullability" do
    test "IS NULL" do
      ast = %Func{name: "is null", args: [%Ref{path: ["deleted_at"]}]}
      assert SqlGenerator.to_sql(ast) == ~s|"deleted_at" IS NULL|
    end

    test "IS NOT NULL" do
      ast = %Func{name: "is not null", args: [%Ref{path: ["email"]}]}
      assert SqlGenerator.to_sql(ast) == ~s|"email" IS NOT NULL|
    end
  end

  describe "boolean tests" do
    test "IS TRUE" do
      ast = %Func{name: "IS_TRUE", args: [%Ref{path: ["active"]}]}
      assert SqlGenerator.to_sql(ast) == ~s|"active" IS TRUE|
    end

    test "IS NOT TRUE" do
      ast = %Func{name: "IS_NOT_TRUE", args: [%Ref{path: ["active"]}]}
      assert SqlGenerator.to_sql(ast) == ~s|"active" IS NOT TRUE|
    end

    test "IS FALSE" do
      ast = %Func{name: "IS_FALSE", args: [%Ref{path: ["deleted"]}]}
      assert SqlGenerator.to_sql(ast) == ~s|"deleted" IS FALSE|
    end

    test "IS NOT FALSE" do
      ast = %Func{name: "IS_NOT_FALSE", args: [%Ref{path: ["enabled"]}]}
      assert SqlGenerator.to_sql(ast) == ~s|"enabled" IS NOT FALSE|
    end

    test "IS UNKNOWN" do
      ast = %Func{name: "IS_UNKNOWN", args: [%Ref{path: ["flag"]}]}
      assert SqlGenerator.to_sql(ast) == ~s|"flag" IS UNKNOWN|
    end

    test "IS NOT UNKNOWN" do
      ast = %Func{name: "IS_NOT_UNKNOWN", args: [%Ref{path: ["flag"]}]}
      assert SqlGenerator.to_sql(ast) == ~s|"flag" IS NOT UNKNOWN|
    end
  end

  describe "membership" do
    test "IN with literal array" do
      ast = %Func{
        name: "in",
        args: [
          %Ref{path: ["status"]},
          %Array{elements: [%Const{value: "a"}, %Const{value: "b"}, %Const{value: "c"}]}
        ]
      }

      assert SqlGenerator.to_sql(ast) == ~s|"status" IN ('a', 'b', 'c')|
    end

    test "IN with integer array" do
      ast = %Func{
        name: "in",
        args: [
          %Ref{path: ["id"]},
          %Array{elements: [%Const{value: 1}, %Const{value: 2}, %Const{value: 3}]}
        ]
      }

      assert SqlGenerator.to_sql(ast) == ~s|"id" IN (1, 2, 3)|
    end
  end

  describe "sublink membership check" do
    test "renders sublink reference" do
      ast = %Func{
        name: "sublink_membership_check",
        args: [
          %Ref{path: ["parent_id"]},
          %Ref{path: ["$sublink", "0"]}
        ]
      }

      assert SqlGenerator.to_sql(ast) == ~s|"parent_id" IN (SELECT $sublink.0)|
    end
  end

  describe "logical operators" do
    test "NOT" do
      inner = %Func{name: "\"=\"", args: [%Ref{path: ["x"]}, %Const{value: 1}]}
      ast = %Func{name: "not", args: [inner]}
      assert SqlGenerator.to_sql(ast) == ~s|NOT "x" = 1|
    end

    test "AND" do
      a = %Func{name: "\"=\"", args: [%Ref{path: ["x"]}, %Const{value: 1}]}
      b = %Func{name: "\"=\"", args: [%Ref{path: ["y"]}, %Const{value: 2}]}
      ast = %Func{name: "and", args: [a, b]}
      assert SqlGenerator.to_sql(ast) == ~s|"x" = 1 AND "y" = 2|
    end

    test "OR" do
      a = %Func{name: "\"=\"", args: [%Ref{path: ["x"]}, %Const{value: 1}]}
      b = %Func{name: "\"=\"", args: [%Ref{path: ["y"]}, %Const{value: 2}]}
      ast = %Func{name: "or", args: [a, b]}
      assert SqlGenerator.to_sql(ast) == ~s|"x" = 1 OR "y" = 2|
    end

    test "nested AND within OR" do
      a = %Func{name: "\"=\"", args: [%Ref{path: ["x"]}, %Const{value: 1}]}
      b = %Func{name: "\"=\"", args: [%Ref{path: ["y"]}, %Const{value: 2}]}
      c = %Func{name: "\"=\"", args: [%Ref{path: ["z"]}, %Const{value: 3}]}
      ast = %Func{name: "or", args: [%Func{name: "and", args: [a, b]}, c]}
      assert SqlGenerator.to_sql(ast) == ~s|"x" = 1 AND "y" = 2 OR "z" = 3|
    end

    test "nested OR within AND" do
      a = %Func{name: "\"=\"", args: [%Ref{path: ["x"]}, %Const{value: 1}]}
      b = %Func{name: "\"=\"", args: [%Ref{path: ["y"]}, %Const{value: 2}]}
      c = %Func{name: "\"=\"", args: [%Ref{path: ["z"]}, %Const{value: 3}]}
      ast = %Func{name: "and", args: [%Func{name: "or", args: [a, b]}, c]}
      assert SqlGenerator.to_sql(ast) == ~s|("x" = 1 OR "y" = 2) AND "z" = 3|
    end

    test "deeply nested logical expression" do
      a = %Func{name: "\"=\"", args: [%Ref{path: ["a"]}, %Const{value: 1}]}
      b = %Func{name: "\">\"", args: [%Ref{path: ["b"]}, %Const{value: 2}]}
      c = %Func{name: "\"<\"", args: [%Ref{path: ["c"]}, %Const{value: 3}]}
      d = %Func{name: "is null", args: [%Ref{path: ["d"]}]}

      ast =
        %Func{
          name: "or",
          args: [
            %Func{name: "and", args: [a, b]},
            %Func{name: "and", args: [c, %Func{name: "not", args: [d]}]}
          ]
        }

      assert SqlGenerator.to_sql(ast) ==
               ~s|"a" = 1 AND "b" > 2 OR "c" < 3 AND NOT "d" IS NULL|
    end
  end

  describe "DISTINCT / NOT DISTINCT" do
    test "IS DISTINCT FROM" do
      left = %Ref{path: ["x"]}
      right = %Const{value: 1}
      comparison = %Func{name: "\"<>\"", args: [left, right]}
      ast = %Func{name: "values_distinct?", args: [left, right, comparison]}
      assert SqlGenerator.to_sql(ast) == ~s|"x" IS DISTINCT FROM 1|
    end

    test "IS NOT DISTINCT FROM" do
      left = %Ref{path: ["x"]}
      right = %Const{value: nil}
      comparison = %Func{name: "\"<>\"", args: [left, right]}
      ast = %Func{name: "values_not_distinct?", args: [left, right, comparison]}
      assert SqlGenerator.to_sql(ast) == ~s|"x" IS NOT DISTINCT FROM NULL|
    end
  end

  describe "ANY / ALL" do
    test "ANY with equals" do
      inner = %Func{
        name: "\"=\"",
        args: [%Ref{path: ["x"]}, %Ref{path: ["arr"]}],
        map_over_array_in_pos: 1
      }

      ast = %Func{name: "any", args: [inner]}
      assert SqlGenerator.to_sql(ast) == ~s|"x" = ANY("arr")|
    end

    test "ALL with less than" do
      inner = %Func{
        name: "\"<\"",
        args: [%Ref{path: ["x"]}, %Ref{path: ["arr"]}],
        map_over_array_in_pos: 1
      }

      ast = %Func{name: "all", args: [inner]}
      assert SqlGenerator.to_sql(ast) == ~s|"x" < ALL("arr")|
    end
  end

  describe "arithmetic operators" do
    test "addition" do
      ast = %Func{name: "\"+\"", args: [%Ref{path: ["x"]}, %Const{value: 1}]}
      assert SqlGenerator.to_sql(ast) == ~s|"x" + 1|
    end

    test "subtraction" do
      ast = %Func{name: "\"-\"", args: [%Ref{path: ["x"]}, %Const{value: 1}]}
      assert SqlGenerator.to_sql(ast) == ~s|"x" - 1|
    end

    test "multiplication" do
      ast = %Func{name: "\"*\"", args: [%Ref{path: ["x"]}, %Const{value: 2}]}
      assert SqlGenerator.to_sql(ast) == ~s|"x" * 2|
    end

    test "division" do
      ast = %Func{name: "\"/\"", args: [%Ref{path: ["x"]}, %Const{value: 2}]}
      assert SqlGenerator.to_sql(ast) == ~s|"x" / 2|
    end

    test "exponentiation" do
      ast = %Func{name: "\"^\"", args: [%Ref{path: ["x"]}, %Const{value: 2}]}
      assert SqlGenerator.to_sql(ast) == ~s|"x" ^ 2|
    end

    test "unary plus" do
      ast = %Func{name: "\"+\"", args: [%Ref{path: ["x"]}]}
      assert SqlGenerator.to_sql(ast) == ~s|+ "x"|
    end

    test "unary minus" do
      ast = %Func{name: "\"-\"", args: [%Ref{path: ["x"]}]}
      assert SqlGenerator.to_sql(ast) == ~s|- "x"|
    end

    test "square root" do
      ast = %Func{name: "\"|/\"", args: [%Ref{path: ["x"]}]}
      assert SqlGenerator.to_sql(ast) == ~s(\|/ "x")
    end

    test "absolute value" do
      ast = %Func{name: "\"@\"", args: [%Ref{path: ["x"]}]}
      assert SqlGenerator.to_sql(ast) == ~s|@ "x"|
    end
  end

  describe "bitwise operators" do
    test "bitwise AND" do
      ast = %Func{name: "\"&\"", args: [%Ref{path: ["x"]}, %Const{value: 3}]}
      assert SqlGenerator.to_sql(ast) == ~s|"x" & 3|
    end

    test "bitwise OR" do
      ast = %Func{name: "\"|\"", args: [%Ref{path: ["x"]}, %Const{value: 3}]}
      assert SqlGenerator.to_sql(ast) == ~s("x" | 3)
    end

    test "bitwise XOR" do
      ast = %Func{name: "\"#\"", args: [%Ref{path: ["x"]}, %Const{value: 3}]}
      assert SqlGenerator.to_sql(ast) == ~s|"x" # 3|
    end

    test "bitwise NOT" do
      ast = %Func{name: "\"~\"", args: [%Ref{path: ["x"]}]}
      assert SqlGenerator.to_sql(ast) == ~s|~ "x"|
    end
  end

  describe "string concatenation" do
    test "||" do
      ast = %Func{name: "\"||\"", args: [%Ref{path: ["first"]}, %Ref{path: ["last"]}]}
      assert SqlGenerator.to_sql(ast) == ~s("first" || "last")
    end
  end

  describe "array operators" do
    test "contains (@>)" do
      ast = %Func{name: "\"@>\"", args: [%Ref{path: ["tags"]}, %Ref{path: ["required"]}]}
      assert SqlGenerator.to_sql(ast) == ~s|"tags" @> "required"|
    end

    test "contained by (<@)" do
      ast = %Func{name: "\"<@\"", args: [%Ref{path: ["tags"]}, %Ref{path: ["allowed"]}]}
      assert SqlGenerator.to_sql(ast) == ~s|"tags" <@ "allowed"|
    end

    test "overlap (&&)" do
      ast = %Func{name: "\"&&\"", args: [%Ref{path: ["a"]}, %Ref{path: ["b"]}]}
      assert SqlGenerator.to_sql(ast) == ~s|"a" && "b"|
    end
  end

  describe "named functions" do
    test "lower" do
      ast = %Func{name: "lower", args: [%Ref{path: ["name"]}]}
      assert SqlGenerator.to_sql(ast) == ~s|lower("name")|
    end

    test "upper" do
      ast = %Func{name: "upper", args: [%Ref{path: ["name"]}]}
      assert SqlGenerator.to_sql(ast) == ~s|upper("name")|
    end

    test "array_ndims" do
      ast = %Func{name: "array_ndims", args: [%Ref{path: ["arr"]}]}
      assert SqlGenerator.to_sql(ast) == ~s|array_ndims("arr")|
    end
  end

  describe "type casts" do
    test "cast with _to_ naming convention" do
      ast = %Func{name: "int4_to_bool", args: [%Ref{path: ["x"]}]}
      assert SqlGenerator.to_sql(ast) == ~s|"x"::bool|
    end

    test "another cast" do
      ast = %Func{name: "text_to_int4", args: [%Ref{path: ["val"]}]}
      assert SqlGenerator.to_sql(ast) == ~s|"val"::int4|
    end
  end

  describe "column references" do
    test "simple column" do
      assert SqlGenerator.to_sql(%Ref{path: ["status"]}) == ~s|"status"|
    end

    test "schema-qualified column" do
      assert SqlGenerator.to_sql(%Ref{path: ["public", "users", "id"]}) ==
               ~s|"public"."users"."id"|
    end
  end

  describe "constants" do
    test "NULL" do
      assert SqlGenerator.to_sql(%Const{value: nil}) == "NULL"
    end

    test "true" do
      assert SqlGenerator.to_sql(%Const{value: true}) == "true"
    end

    test "false" do
      assert SqlGenerator.to_sql(%Const{value: false}) == "false"
    end

    test "string" do
      assert SqlGenerator.to_sql(%Const{value: "hello"}) == "'hello'"
    end

    test "string with single quote escaping" do
      assert SqlGenerator.to_sql(%Const{value: "it's"}) == "'it''s'"
    end

    test "integer" do
      assert SqlGenerator.to_sql(%Const{value: 42}) == "42"
    end

    test "float" do
      assert SqlGenerator.to_sql(%Const{value: 3.14}) == "3.14"
    end

    test "negative integer" do
      assert SqlGenerator.to_sql(%Const{value: -1}) == "-1"
    end
  end

  describe "array literals" do
    test "simple array" do
      ast = %Array{elements: [%Const{value: 1}, %Const{value: 2}, %Const{value: 3}]}
      assert SqlGenerator.to_sql(ast) == "ARRAY[1, 2, 3]"
    end

    test "string array" do
      ast = %Array{elements: [%Const{value: "a"}, %Const{value: "b"}]}
      assert SqlGenerator.to_sql(ast) == "ARRAY['a', 'b']"
    end

    test "empty array" do
      ast = %Array{elements: []}
      assert SqlGenerator.to_sql(ast) == "ARRAY[]"
    end
  end

  describe "row expressions" do
    test "simple row" do
      ast = %RowExpr{elements: [%Ref{path: ["a"]}, %Ref{path: ["b"]}]}
      assert SqlGenerator.to_sql(ast) == ~s|ROW("a", "b")|
    end

    test "row in sublink membership check" do
      row = %RowExpr{elements: [%Ref{path: ["a"]}, %Ref{path: ["b"]}]}

      ast = %Func{
        name: "sublink_membership_check",
        args: [row, %Ref{path: ["$sublink", "0"]}]
      }

      assert SqlGenerator.to_sql(ast) == ~s|ROW("a", "b") IN (SELECT $sublink.0)|
    end
  end

  describe "date/time/interval constants" do
    test "date" do
      ast = %Const{value: ~D[2024-01-15]}
      assert SqlGenerator.to_sql(ast) == "'2024-01-15'::date"
    end

    test "time" do
      ast = %Const{value: ~T[13:45:00]}
      assert SqlGenerator.to_sql(ast) == "'13:45:00'::time"
    end

    test "timestamp (NaiveDateTime)" do
      ast = %Const{value: ~N[2024-01-15 13:45:00]}
      assert SqlGenerator.to_sql(ast) == "'2024-01-15T13:45:00'::timestamp"
    end

    test "timestamptz (DateTime)" do
      ast = %Const{value: DateTime.from_naive!(~N[2024-01-15 13:45:00], "Etc/UTC")}
      assert SqlGenerator.to_sql(ast) == "'2024-01-15T13:45:00Z'::timestamptz"
    end

    test "interval" do
      ast = %Const{value: PgInterop.Interval.parse!("1 year 2 months 3 days")}
      result = SqlGenerator.to_sql(ast)
      assert result =~ ~r/^'.*'::interval$/
    end
  end

  describe "error handling" do
    test "raises ArgumentError for unsupported AST node" do
      assert_raise ArgumentError, ~r/unsupported AST node/, fn ->
        SqlGenerator.to_sql(%{unexpected: :node})
      end
    end

    test "raises ArgumentError for unknown function name" do
      assert_raise ArgumentError, ~r/unsupported AST node/, fn ->
        SqlGenerator.to_sql(%Func{name: "totally_unknown_func", args: [%Const{value: 1}]})
      end
    end
  end

  describe "complex nested expressions" do
    test "WHERE clause with AND, OR, comparisons and NULL check" do
      status_check = %Func{
        name: "\"=\"",
        args: [%Ref{path: ["status"]}, %Const{value: "active"}]
      }

      age_check = %Func{name: "\">=\"", args: [%Ref{path: ["age"]}, %Const{value: 18}]}
      email_check = %Func{name: "is not null", args: [%Ref{path: ["email"]}]}

      ast =
        %Func{
          name: "and",
          args: [
            %Func{name: "or", args: [status_check, age_check]},
            email_check
          ]
        }

      assert SqlGenerator.to_sql(ast) ==
               ~s|("status" = 'active' OR "age" >= 18) AND "email" IS NOT NULL|
    end

    test "NOT with nested OR" do
      a = %Func{name: "\"=\"", args: [%Ref{path: ["x"]}, %Const{value: 1}]}
      b = %Func{name: "\"=\"", args: [%Ref{path: ["y"]}, %Const{value: 2}]}

      ast = %Func{name: "not", args: [%Func{name: "or", args: [a, b]}]}

      assert SqlGenerator.to_sql(ast) == ~s|NOT ("x" = 1 OR "y" = 2)|
    end

    test "comparison with string concatenation" do
      concat = %Func{name: "\"||\"", args: [%Ref{path: ["first"]}, %Ref{path: ["last"]}]}
      ast = %Func{name: "\"=\"", args: [concat, %Const{value: "JohnDoe"}]}
      assert SqlGenerator.to_sql(ast) == ~s("first" || "last" = 'JohnDoe')
    end

    test "precedence: multiplication inside addition" do
      # (a * b) + c — no parens needed since * binds tighter
      mul = %Func{name: "\"*\"", args: [%Ref{path: ["a"]}, %Ref{path: ["b"]}]}
      ast = %Func{name: "\"+\"", args: [mul, %Ref{path: ["c"]}]}
      assert SqlGenerator.to_sql(ast) == ~s|"a" * "b" + "c"|
    end

    test "precedence: addition inside multiplication" do
      # a * (b + c) — parens needed since + binds looser
      add = %Func{name: "\"+\"", args: [%Ref{path: ["b"]}, %Ref{path: ["c"]}]}
      ast = %Func{name: "\"*\"", args: [%Ref{path: ["a"]}, add]}
      assert SqlGenerator.to_sql(ast) == ~s|"a" * ("b" + "c")|
    end

    test "precedence: left-associative subtraction" do
      # a - (b - c) — parens needed on right child
      inner = %Func{name: "\"-\"", args: [%Ref{path: ["b"]}, %Ref{path: ["c"]}]}
      ast = %Func{name: "\"-\"", args: [%Ref{path: ["a"]}, inner]}
      assert SqlGenerator.to_sql(ast) == ~s|"a" - ("b" - "c")|
    end

    test "precedence: left-associative subtraction, left child" do
      # (a - b) - c — no parens needed (left-associative)
      inner = %Func{name: "\"-\"", args: [%Ref{path: ["a"]}, %Ref{path: ["b"]}]}
      ast = %Func{name: "\"-\"", args: [inner, %Ref{path: ["c"]}]}
      assert SqlGenerator.to_sql(ast) == ~s|"a" - "b" - "c"|
    end

    test "precedence: right-associative exponentiation" do
      # a ^ (b ^ c) — no parens needed (right-associative)
      inner = %Func{name: "\"^\"", args: [%Ref{path: ["b"]}, %Ref{path: ["c"]}]}
      ast = %Func{name: "\"^\"", args: [%Ref{path: ["a"]}, inner]}
      assert SqlGenerator.to_sql(ast) == ~s|"a" ^ "b" ^ "c"|
    end

    test "precedence: right-associative exponentiation, left child" do
      # (a ^ b) ^ c — parens needed on left child
      inner = %Func{name: "\"^\"", args: [%Ref{path: ["a"]}, %Ref{path: ["b"]}]}
      ast = %Func{name: "\"^\"", args: [inner, %Ref{path: ["c"]}]}
      assert SqlGenerator.to_sql(ast) == ~s|("a" ^ "b") ^ "c"|
    end
  end

  describe "to_sql is the inverse of parse" do
    use ExUnitProperties

    alias Electric.Replication.Eval.Parser
    alias Support.PgExpressionGenerator

    property "to_sql output is parseable for any parseable WHERE clause" do
      check all(
              {sql, refs} <- PgExpressionGenerator.where_clause_generator(),
              max_runs: 1_000,
              max_run_time: 10_000
            ) do
        assert_to_sql_inverts_parse(sql, refs)
      end
    end

    defp assert_to_sql_inverts_parse(sql, refs) do
      # The parser may raise on some generated expressions (pre-existing parser
      # limitations). We rescue those and skip — we only care that successfully
      # parsed expressions produce valid SQL via to_sql.
      parsed =
        try do
          Parser.parse_and_validate_expression(sql, refs: refs)
        rescue
          _ -> :skip
        end

      case parsed do
        {:ok, %{eval: ast}} ->
          regenerated = SqlGenerator.to_sql(ast)

          reparsed =
            try do
              Parser.parse_and_validate_expression(regenerated, refs: refs)
            rescue
              e ->
                flunk(
                  "to_sql output raised #{inspect(e)} when re-parsing: #{regenerated} (from: #{sql})"
                )
            end

          assert {:ok, _} = reparsed,
                 "to_sql output is not valid SQL: #{regenerated} (from: #{sql})"

        {:error, _reason} ->
          :ok

        :skip ->
          :ok
      end
    end
  end
end
