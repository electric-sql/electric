defmodule Electric.Replication.Eval.ParserTest do
  use ExUnit.Case, async: true

  alias Electric.Replication.Eval.Env.ExplicitCasts
  alias Electric.Replication.Eval.Parser
  alias Electric.Replication.Eval.Parser.{Array, Const, Func, Ref}
  alias Electric.Replication.Eval.Env
  alias Electric.Replication.Eval.Expr

  @int_to_bool_casts %{
    {:int4, :bool} => {ExplicitCasts, :int4_to_bool},
    {:bool, :int4} => {ExplicitCasts, :bool_to_int4}
  }

  describe "extract_parts_from_select/1" do
    test "should correctly extract columns" do
      assert {:ok, {columns, from, where}} =
               Parser.extract_parts_from_select("SELECT c1, c2 FROM t2")

      assert columns == ["c1", "c2"]
      assert from == {"public", "t2"}
      assert where == nil
    end

    test "should correctly extract where clause" do
      assert {:ok, {columns, from, where}} =
               Parser.extract_parts_from_select("SELECT c1, c2 FROM t2 WHERE c1 = 1")

      assert columns == ["c1", "c2"]
      assert from == {"public", "t2"}
      assert %PgQuery.Node{} = where
    end
  end

  describe "parse_and_validate_expression/3 basics" do
    test "should correctly parse constants" do
      assert {:ok, %Expr{eval: result}} = Parser.parse_and_validate_expression("TRUE")
      assert %Const{value: true} = result
    end

    test "should work with unknown constants" do
      assert {:ok, %Expr{eval: result}} = Parser.parse_and_validate_expression("'test'")
      assert %Const{value: "test", type: :text} = result
    end

    test "should return an error for oversized queries" do
      # Generate a where clause that exceeds pg_query's maximum query size of 65536 bytes
      large_where = "id = '" <> String.duplicate("a", 70_000) <> "'"

      assert {:error, message} = Parser.parse_and_validate_expression(large_where)
      assert message =~ "bigger than maximum size"
    end

    test "should correctly parse type casts on constants" do
      assert {:error, "At location 0: unknown cast from type int4 to type bool"} =
               Parser.parse_and_validate_expression("1::boolean", env: Env.empty())
    end

    test "should fail on references that don't exist" do
      assert {:error, "At location 0: unknown reference test"} =
               Parser.parse_and_validate_expression(~S|"test"|)
    end

    test "should fail helpfully on references that might exist" do
      assert {:error, "At location 0: unknown reference test - did you mean `this.test`?"} =
               Parser.parse_and_validate_expression(~S|"test"|,
                 refs: %{["this", "test"] => :bool}
               )
    end

    test "should correctly parse a known reference" do
      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(~S|"test"|, refs: %{["test"] => :bool})

      assert %Ref{path: ["test"], type: :bool} = result
    end

    test "should correctly cast an enum to text" do
      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(
                 ~S|foo::text|,
                 refs: %{["foo"] => {:enum, "foo_enum"}},
                 env: Env.empty()
               )

      assert %Ref{path: ["foo"], type: :text} = result
    end

    test "should correctly parse a boolean function" do
      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(~S|"test" OR true|,
                 refs: %{["test"] => :bool}
               )

      assert %Func{name: "or", args: [%Ref{path: ["test"], type: :bool}, %Const{value: true}]} =
               result
    end

    test "should correctly parse a cast on reference" do
      env = Env.empty(explicit_casts: @int_to_bool_casts)

      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(
                 ~S|"test"::integer|,
                 refs: %{["test"] => :bool},
                 env: env
               )

      assert %Func{name: "bool_to_int4", args: [%Ref{path: ["test"], type: :bool}]} = result
    end

    test "should correctly cast a const at compile time" do
      env = Env.empty(explicit_casts: @int_to_bool_casts)

      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(
                 ~S|true::integer|,
                 refs: %{["test"] => :bool},
                 env: env
               )

      assert %Const{type: :int4, value: 1} = result
    end

    test "should correctly process a cast chain" do
      env = Env.empty(explicit_casts: @int_to_bool_casts)

      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(
                 ~S|true::integer::bool::integer::bool::integer|,
                 env: env
               )

      assert %Const{type: :int4, value: 1} = result
    end

    test "should correctly parse a unary operator" do
      env =
        Env.empty(
          operators: %{
            {~s|"-"|, 1} => [
              %{args: [:numeric], returns: :numeric, implementation: & &1, name: "-"}
            ]
          }
        )

      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(~S|- "test"|,
                 refs: %{["test"] => :int4},
                 env: env
               )

      assert %Func{name: "-", args: [%Ref{path: ["test"], type: :int4}]} = result
    end

    test "should correctly parse a binary operator" do
      env =
        Env.empty(
          operators: %{
            {~s|"+"|, 2} => [
              %{args: [:numeric, :numeric], returns: :numeric, implementation: & &1, name: "+"}
            ]
          }
        )

      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(
                 ~S|"test" + "test"|,
                 refs: %{["test"] => :int4},
                 env: env
               )

      assert %Func{
               name: "+",
               args: [%Ref{path: ["test"], type: :int4}, %Ref{path: ["test"], type: :int4}]
             } = result
    end

    test "should correctly cast unknowns to knowns for a binary operator" do
      env =
        Env.empty(
          operators: %{
            {~s|"+"|, 2} => [
              %{args: [:int4, :int4], returns: :int4, implementation: & &1, name: "+"}
            ]
          }
        )

      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(
                 ~S|"test" + '4'|,
                 refs: %{["test"] => :int4},
                 env: env
               )

      assert %Func{
               name: "+",
               args: [%Ref{path: ["test"], type: :int4}, %Const{type: :int4, value: 4}]
             } = result
    end

    test "should correctly pick an overload between operators" do
      env =
        Env.empty(
          operators: %{
            {~s|"+"|, 2} => [
              %{args: [:int8, :int8], returns: :int8, implementation: &Kernel.+/2, name: "int4"},
              %{
                args: [:float8, :float8],
                returns: :float8,
                implementation: &Kernel.+/2,
                name: "float8"
              },
              %{args: [:text, :text], returns: :text, implementation: &Kernel.<>/2, name: "text"}
            ]
          }
        )

      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(
                 ~S|"test" + '4'|,
                 refs: %{["test"] => :int4},
                 env: env
               )

      assert %Func{
               name: "float8",
               args: [%Ref{path: ["test"], type: :int4}, %Const{type: :float8, value: 4.0}]
             } = result
    end

    test "should fail on a function with aggregation" do
      assert {:error, "At location 0: aggregation is not supported in this context"} =
               Parser.parse_and_validate_expression(~S|ceil(DISTINCT "test")|,
                 refs: %{
                   ["test"] => :int4
                 }
               )
    end

    test "should correctly parse a function call" do
      env =
        Env.new(
          funcs: %{
            {"ceil", 1} => [
              %{args: [:numeric], returns: :numeric, implementation: & &1, name: "-"}
            ]
          }
        )

      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(
                 ~S|ceil("test")|,
                 refs: %{["test"] => :int4},
                 env: env
               )

      assert %Func{name: "-", args: [%Ref{path: ["test"], type: :int4}]} = result
    end

    test "should reject explicit variadic function calls for now" do
      assert {:error,
              "At location 0: explicit VARIADIC function calls are not currently supported"} =
               Parser.parse_and_validate_expression(
                 ~S|array_cat(VARIADIC ARRAY[ARRAY[1], ARRAY[2]])|
               )
    end

    test "should correctly parse coalesce special form as a variadic function" do
      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(
                 ~S|coalesce("test", 'fallback')|,
                 refs: %{["test"] => :text}
               )

      assert %Func{
               name: "coalesce",
               variadic_arg: 0,
               strict?: false,
               type: :text,
               args: [
                 %Array{
                   type: {:array, :text},
                   elements: [
                     %Ref{path: ["test"], type: :text},
                     %Const{type: :text, value: "fallback"}
                   ]
                 }
               ]
             } = result
    end

    test "should correctly resolve a variadic greatest special form" do
      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(
                 ~S|greatest("test", 2, '3')|,
                 refs: %{["test"] => :int4}
               )

      assert %Func{
               name: "greatest",
               variadic_arg: 0,
               strict?: false,
               type: :int4,
               args: [
                 %Array{
                   type: {:array, :int4},
                   elements: [
                     %Ref{path: ["test"], type: :int4},
                     %Const{type: :int4, value: 2},
                     %Const{type: :int4, value: 3}
                   ]
                 }
               ]
             } = result
    end

    test "should correctly resolve a variadic least special form" do
      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(
                 ~S|least("test", 2.0, '3')|,
                 refs: %{["test"] => :int4}
               )

      assert %Func{
               name: "least",
               variadic_arg: 0,
               strict?: false,
               type: :numeric,
               args: [
                 %Array{
                   type: {:array, :numeric},
                   elements: [
                     %Ref{path: ["test"], type: :int4},
                     %Const{type: :numeric, value: 2.0},
                     %Const{type: :numeric, value: 3.0}
                   ]
                 }
               ]
             } = result
    end

    test "should prefer an exact non-variadic overload over a variadic expansion" do
      env =
        Env.empty(
          funcs: %{
            {"prefer_exact", 1} => [
              %{
                args: [:int4],
                variadic_arg: 0,
                returns: :int4,
                implementation: &List.first/1,
                name: "variadic"
              }
            ],
            {"prefer_exact", 2} => [
              %{
                args: [:int4, :int4],
                returns: :int4,
                implementation: &Kernel.+/2,
                name: "exact"
              }
            ]
          }
        )

      assert {:ok, %Expr{eval: %Func{name: "exact"}}} =
               Parser.parse_and_validate_expression(
                 ~S|prefer_exact("test", 2)|,
                 refs: %{["test"] => :int4},
                 env: env
               )
    end

    test "should reduce down immutable function calls that have only constants" do
      env =
        Env.empty(
          operators: %{
            {~s|"+"|, 2} => [
              %{args: [:int4, :int4], returns: :int4, implementation: &Kernel.+/2, name: "+"},
              %{
                args: [:float8, :float8],
                returns: :float8,
                implementation: &Kernel.+/2,
                name: "+"
              },
              %{args: [:text, :text], returns: :text, implementation: &Kernel.<>/2, name: "||"}
            ]
          }
        )

      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(~S|1 + 1|,
                 refs: %{["test"] => :int4},
                 env: env
               )

      assert %Const{value: 2, type: :int4} = result
    end

    test "should correctly apply a commutative overload operator by reversing the arguments" do
      env =
        Env.empty(
          operators: %{
            {~s|"+"|, 2} => [
              %{
                name: "create timestamp",
                args: [:time, :date],
                commutative_overload?: true,
                returns: :timestamp,
                implementation: &NaiveDateTime.new!/2
              }
            ]
          }
        )

      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(
                 ~S|time '20:00:00' + date '2024-01-01'|,
                 refs: %{["test"] => :int4},
                 env: env
               )

      assert %Const{value: ~N[2024-01-01 20:00:00], type: :timestamp} = result
    end

    test "should work with IS [NOT] DISTINCT FROM clauses" do
      env = Env.new()

      for {expr, expected} <- [
            {~S|1 IS DISTINCT FROM 2|, true},
            {~S|1 IS DISTINCT FROM NULL|, true},
            {~S|NULL IS DISTINCT FROM NULL|, false},
            {~S|1 IS NOT DISTINCT FROM 2|, false},
            {~S|'foo' IS NOT DISTINCT FROM NULL|, false},
            {~S|NULL IS NOT DISTINCT FROM NULL|, true}
          ] do
        assert {{:ok, %Expr{eval: result}}, ^expr} =
                 {Parser.parse_and_validate_expression(expr, env: env), expr}

        assert {%Const{value: ^expected, type: :bool}, ^expr} = {result, expr}
      end
    end

    test "should work with IS [NOT] UNKNOWN" do
      env = Env.new()

      for {expr, expected} <- [
            {~S|true IS UNKNOWN|, false},
            {~S|true IS NOT UNKNOWN|, true},
            {~S|NULL::boolean IS UNKNOWN|, true},
            {~S|NULL::boolean IS NOT UNKNOWN|, false},
            {~S|NULL IS UNKNOWN|, true},
            {~S|NULL IS NOT UNKNOWN|, false}
          ] do
        assert {{:ok, %Expr{eval: result}}, ^expr} =
                 {Parser.parse_and_validate_expression(expr, env: env), expr}

        assert {%Const{value: ^expected, type: :bool}, ^expr} = {result, expr}
      end
    end

    test "should work with LIKE clauses" do
      env = Env.new()

      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(
                 ~S|'hello' NOT LIKE 'hell\%' AND 'hello' LIKE 'h%o' |,
                 env: env
               )

      assert %Const{value: true, type: :bool} = result
    end

    test "should work with LIKE and ILIKE functions" do
      env = Env.new()

      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(
                 ~S|NOT LIKE('hello', 'hell\%') AND ILIKE('hello', 'h%o') |,
                 env: env
               )

      assert %Const{value: true, type: :bool} = result
    end

    test "should work with BETWEEN clauses" do
      env = Env.new()

      for {expr, expected} <- [
            {~S|0 BETWEEN 1 AND 3|, false},
            {~S|1 BETWEEN 1 AND 3|, true},
            {~S|2 BETWEEN 1 AND 3|, true},
            {~S|3 BETWEEN 1 AND 3|, true},
            {~S|4 BETWEEN 1 AND 3|, false},
            {~S|2 NOT BETWEEN 1 AND 3|, false},
            {~S|1 BETWEEN 3 AND 1|, false},
            {~S|1 NOT BETWEEN 3 AND 1|, true},
            {~S|2 BETWEEN SYMMETRIC 3 AND 1|, true},
            {~S|2 NOT BETWEEN SYMMETRIC 3 AND 1|, false},
            {~S|'2024-07-31'::date BETWEEN '2024-07-01'::date AND '2024-07-31'::date|, true},
            {~S|'2024-07-31'::date NOT BETWEEN '2024-07-01'::date AND '2024-07-31'::date|, false},
            {~S|'2024-06-30'::date BETWEEN '2024-07-01'::date AND '2024-07-31'::date|, false},
            {~S|'2024-06-30'::date NOT BETWEEN '2024-07-01'::date AND '2024-07-31'::date|, true},
            {~S|'2024-07-15'::date BETWEEN SYMMETRIC '2024-07-31'::date AND '2024-07-01'::date|,
             true},
            {~S|'2024-07-15'::date NOT BETWEEN SYMMETRIC '2024-07-31'::date AND '2024-07-01'::date|,
             false}
          ] do
        assert {:ok, %Expr{eval: result}} =
                 Parser.parse_and_validate_expression(expr, env: env)

        assert %Const{value: ^expected, type: :bool} = result
      end
    end

    test "should work with explicit casts" do
      env = Env.new()

      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(~S|1::boolean|, env: env)

      assert %Const{value: true, type: :bool} = result
    end

    test "should work with IN clauses" do
      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(~S|1 IN (1, 2, 3)|)

      assert %Const{value: true, type: :bool} = result
    end

    test "should work with NOT IN clauses" do
      env = Env.new()

      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(
                 ~S|'test' NOT IN ('hello', 'world')|,
                 env: env
               )

      assert %Const{value: true, type: :bool} = result
    end

    test "should work with IN clauses when one of the options is NULL (by converting everything to NULL)" do
      # https://www.postgresql.org/docs/current/functions-comparisons.html#FUNCTIONS-COMPARISONS-IN-SCALAR
      env = Env.new()

      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(
                 ~S|'test' IN ('hello', NULL)|,
                 env: env
               )

      assert %Const{value: nil, type: :bool} = result
    end

    test "should allow subqueries in IN clauses" do
      env = Env.new()

      assert {:ok, %Expr{eval: _result}} =
               Parser.parse_and_validate_expression(
                 ~S|test IN (SELECT val FROM tester)|,
                 refs: %{["test"] => :int4, ["$sublink", "0"] => {:array, :int4}},
                 sublink_queries: %{0 => "SELECT val FROM tester"},
                 env: env
               )
    end

    test "should allow subqueries in IN clauses with composite PKs" do
      env = Env.new()

      assert {:ok, %Expr{eval: _result}} =
               Parser.parse_and_validate_expression(
                 ~S|(test1, test2) IN (SELECT val1, val2 FROM tester)|,
                 refs: %{
                   ["test1"] => :int4,
                   ["test2"] => :int4,
                   ["$sublink", "0"] => {:array, {:row, [:int4, :int4]}}
                 },
                 sublink_queries: %{0 => "SELECT val1, val2 FROM tester"},
                 env: env
               )
    end

    test "should support complex operations with dates" do
      env = Env.new()

      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(
                 ~S|date '2024-01-01' < interval '1 month 1 hour' + date '2023-12-01'|,
                 env: env
               )

      assert %Const{value: true, type: :bool} = result
    end

    test "should support `AT TIME ZONE`" do
      env = Env.new()

      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(
                 ~S|timestamp '2001-02-16 20:38:40' at time zone 'America/Denver' = '2001-02-17 03:38:40+00'|,
                 env: env
               )

      assert %Const{value: true, type: :bool} = result

      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(
                 ~S|timestamp with time zone '2001-02-16 20:38:40+03' at time zone 'America/Denver' = '2001-02-16 10:38:40'|,
                 env: env
               )

      assert %Const{value: true, type: :bool} = result
    end

    test "should support IS [NOT] NULL" do
      env = Env.new()

      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(~S|null IS NULL|, env: env)

      assert %Const{value: true, type: :bool} = result

      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(~S|false IS NOT NULL|, env: env)

      assert %Const{value: true, type: :bool} = result

      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(~S|(1 = NULL) IS NULL|, env: env)

      assert %Const{value: true, type: :bool} = result
    end

    test "should support IS [NOT] TRUE/FALSE" do
      env = Env.new()

      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(~S|'true' IS TRUE|, env: env)

      assert %Const{value: true, type: :bool} = result

      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(~S|false IS NOT TRUE|, env: env)

      assert %Const{value: true, type: :bool} = result

      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(~S|null IS NOT FALSE|, env: env)

      assert %Const{value: true, type: :bool} = result

      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(~S|null IS FALSE|, env: env)

      assert %Const{value: false, type: :bool} = result

      assert {:error, "At location 2: argument of IS TRUE must be bool, not int4"} =
               Parser.parse_and_validate_expression(~S|1 IS TRUE|, env: env)
    end

    test "should parse array constants" do
      # TODO: Does not support arbitrary bounds input syntax yet,
      #       e.g. '[1:1][-2:-1][3:5]={{{1,2,3},{4,5,6}}}'::int[]
      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(~S|'{{1   },{2},{"3"}}'::int[]|)

      assert %Const{value: [[1], [2], [3]], type: {:array, :int4}} = result

      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(~S|ARRAY[ARRAY[1, 2], ARRAY['3', 2 + 2]]|)

      assert %Const{value: [[1, 2], [3, 4]], type: {:array, :int4}} = result

      assert {:error, "At location 0: ARRAY types int4[] and int4 cannot be matched"} =
               Parser.parse_and_validate_expression(~S|ARRAY[1, ARRAY['3', 2 + 2]]|)
    end

    test "should recast a nested array" do
      # as-is recast
      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(~S|('{{1},{2},{"3"}}'::int[])::bigint[]|)

      assert %Const{value: [[1], [2], [3]], type: {:array, :int8}} = result

      # with a cast function
      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(~S|('{{1},{2},{"3"}}'::text[])::bigint[]|)

      assert %Const{value: [[1], [2], [3]], type: {:array, :int8}} = result
    end

    test "should work with array access" do
      # Including mixed notation, float constants, and text castable to ints
      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(~S|('{1,2,3}'::int[])[1][1:'2'][2.2:2.3][:]|)

      assert %Const{value: [], type: {:array, :int4}} = result

      # Returns NULL if any of indices are NULL
      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(
                 ~S|('{1,2,3}'::int[])[1][1:'2'][2.2:2.3][:][NULL:NULL]|
               )

      assert %Const{value: nil, type: {:array, :int4}} = result

      # Also works when there are no slices
      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(
                 ~S|('{{{1}},{{2}},{{3}}}'::int[])[1]['1'][1.4]|
               )

      assert %Const{value: 1, type: :int4} = result

      # And correctly works with expressions as indices
      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(~S|('{{1},{2},{3}}'::int[])[2][2 - 1]|)

      assert %Const{value: 2, type: :int4} = result
    end

    test "should support array ANY/ALL" do
      assert {:error, "At location 9: argument of ANY must be an array"} =
               Parser.parse_and_validate_expression(~S|3 > ANY (3)|)

      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(~S|3 > ANY ('{1, 2, 3}')|)

      assert %Const{value: true, type: :bool} = result

      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(~S|1::bigint = ANY ('{1,2}'::int[])|)

      assert %Const{value: true, type: :bool} = result

      # Including implicit casts and nested arrays
      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(~S|4.1 > ALL ('{{1}, {2}, {3}}'::int[])|)

      assert %Const{value: true, type: :bool} = result
    end
  end

  describe "parse_and_validate_expression/3 default env" do
    test "can compare integers" do
      assert {:ok, _} =
               Parser.parse_and_validate_expression(~S|id != 1|, refs: %{["id"] => :int8})

      assert {:ok, _} =
               Parser.parse_and_validate_expression(~S|id <> 1|, refs: %{["id"] => :int8})

      assert {:ok, _} = Parser.parse_and_validate_expression(~S|id > 1|, refs: %{["id"] => :int8})
      assert {:ok, _} = Parser.parse_and_validate_expression(~S|id < 1|, refs: %{["id"] => :int8})

      assert {:ok, _} =
               Parser.parse_and_validate_expression(~S|id >= 1|, refs: %{["id"] => :int8})

      assert {:ok, _} =
               Parser.parse_and_validate_expression(~S|id <= 1|, refs: %{["id"] => :int8})

      assert {:ok, _} = Parser.parse_and_validate_expression(~S|id = 1|, refs: %{["id"] => :int8})
    end

    test "implements common array operators: @>, <@, &&, ||" do
      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(~S|'{1,2,3}'::int[] @> '{2,1,2}'|)

      assert %Const{value: true, type: :bool} = result

      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(~S|'{1,2,3}'::int[] <@ '{1,2,2}'::int[]|)

      assert %Const{value: false, type: :bool} = result

      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(~S|'{1,2,1}'::int[] && '{2,3,4}'::int[]|)

      assert %Const{value: true, type: :bool} = result

      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(~S"'{1,2,1}'::int[] || '{2,3,4}'")

      assert %Const{value: [1, 2, 1, 2, 3, 4], type: {:array, :int4}} = result

      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(~S"('1'::bigint || '{2,3,4}'::int[]) || 5")

      assert %Const{value: [1, 2, 3, 4, 5], type: {:array, :int8}} = result

      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(~S"array_ndims('{{1,2,3},{4,5,6}}')")

      assert %Const{value: 2, type: :int4} = result
    end

    test "does correct operator inference for array polymorphic types" do
      assert {:error, "At location 17: Could not select an operator overload"} =
               Parser.parse_and_validate_expression(~S|'{1,2,3}'::int[] @> '{2,1,2}'::bigint[]|)

      assert {:error, "At location 17: Could not select an operator overload"} =
               Parser.parse_and_validate_expression(~S|'{1,2,3}'::int[] @> '{2,1,2}'::text[]|)

      assert {:error, "At location 17: Could not select an operator overload"} =
               Parser.parse_and_validate_expression(~S/'{1,2,3}'::int[] || '{2,1,2}'::text[]/)
    end

    test "rejects comparison of mismatched enum types" do
      refs = %{
        ["col1"] => {:enum, "test_enum1"},
        ["col2"] => {:enum, "test_enum2"}
      }

      env = %{Env.new() | allow_enums: true}

      assert {:error, "At location 5: Could not select an operator overload"} =
               Parser.parse_and_validate_expression(
                 ~S|col1 = col2|,
                 refs: refs,
                 env: env
               )
    end
  end

  describe "validate_order_by/2" do
    @columns [%{name: "id"}, %{name: "value"}, %{name: "created_at"}]

    test "accepts valid column references and returns normalized SQL" do
      assert {:ok, "id ASC"} = Parser.validate_order_by("id ASC", @columns)
      assert {:ok, "value DESC"} = Parser.validate_order_by("value DESC", @columns)
      assert {:ok, _} = Parser.validate_order_by("id ASC, value DESC", @columns)
      assert {:ok, _} = Parser.validate_order_by("created_at ASC NULLS LAST", @columns)
    end

    test "rejects references to non-existent columns" do
      assert {:error, "At location " <> _} =
               Parser.validate_order_by("nonexistent ASC", @columns)
    end

    test "rejects parameter placeholders" do
      assert {:error, "At location " <> rest} = Parser.validate_order_by("$1", @columns)
      assert rest =~ "parameter $1 is not supported in ORDER BY clauses"

      assert {:error, "At location " <> rest} =
               Parser.validate_order_by("$1 ASC, $2 DESC", @columns)

      assert rest =~ "parameter $1 is not supported in ORDER BY clauses"
    end

    test "rejects parameter placeholders mixed with valid columns" do
      assert {:error, "At location " <> rest} =
               Parser.validate_order_by("id ASC, $1 DESC", @columns)

      assert rest =~ "parameter $1 is not supported in ORDER BY clauses"
    end

    test "rejects multiple statements" do
      assert {:error, "Unexpected `;` in order by"} =
               Parser.validate_order_by("id; DROP TABLE users", @columns)
    end

    test "rejects CAST with subquery (error-based injection)" do
      assert {:error, "At location " <> rest} =
               Parser.validate_order_by(~s|CAST((SELECT 1) AS int)|, @columns)

      assert rest =~ "not allowed in ORDER BY"
    end

    test "rejects bare subqueries" do
      assert {:error, "At location " <> rest} =
               Parser.validate_order_by(~s|(SELECT count(*) FROM pg_tables)|, @columns)

      assert rest =~ "not allowed in ORDER BY"
    end

    test "rejects function calls" do
      assert {:error, "At location " <> rest} =
               Parser.validate_order_by(~s|pg_sleep(5)|, @columns)

      assert rest =~ "not allowed in ORDER BY"

      assert {:error, _} = Parser.validate_order_by(~s|current_user|, @columns)
    end

    test "rejects CASE expressions" do
      assert {:error, "At location " <> rest} =
               Parser.validate_order_by(
                 ~s|CASE WHEN (SELECT true) THEN 1 ELSE 0 END|,
                 @columns
               )

      assert rest =~ "not allowed in ORDER BY"
    end

    test "rejects arithmetic expressions with subqueries" do
      assert {:error, "At location " <> rest} =
               Parser.validate_order_by(~s|1 + (SELECT 1)|, @columns)

      assert rest =~ "not allowed in ORDER BY"
    end

    test "rejects type casts" do
      assert {:error, "At location " <> rest} =
               Parser.validate_order_by(~s|id::text|, @columns)

      assert rest =~ "not allowed in ORDER BY"

      assert {:error, "At location " <> rest} =
               Parser.validate_order_by(~s|CAST(id AS text)|, @columns)

      assert rest =~ "not allowed in ORDER BY"
    end

    test "rejects injection mixed with valid columns" do
      assert {:error, "At location " <> rest} =
               Parser.validate_order_by(
                 ~s|id ASC, CAST((SELECT version()) AS int) DESC|,
                 @columns
               )

      assert rest =~ "not allowed in ORDER BY"
    end

    # --- Pentest reproduction vectors (error-based extraction) ---

    test "rejects CAST with version() extraction" do
      assert {:error, _} =
               Parser.validate_order_by(~s|CAST((SELECT version()) AS int) DESC|, @columns)
    end

    test "rejects CAST with current_user extraction" do
      assert {:error, _} =
               Parser.validate_order_by(~s|CAST((SELECT current_user) AS int) DESC|, @columns)
    end

    test "rejects string_agg enumeration of information_schema" do
      payload =
        ~s[CAST((SELECT string_agg(table_name, chr(44)) FROM information_schema.tables WHERE table_schema = chr(112)||chr(117)||chr(98)||chr(108)||chr(105)||chr(99)) AS int) DESC]

      assert {:error, _} = Parser.validate_order_by(payload, @columns)
    end

    test "rejects pg_sleep time-based blind injection" do
      assert {:error, _} =
               Parser.validate_order_by(~s|CAST((SELECT pg_sleep(3)) AS int) DESC|, @columns)
    end

    test "rejects cross-table data extraction via subquery" do
      assert {:error, _} =
               Parser.validate_order_by(
                 ~s|CAST((SELECT id::text FROM organizations LIMIT 1 OFFSET 0) AS int) DESC|,
                 @columns
               )
    end

    # --- Additional attack surface coverage ---

    test "rejects boolean-based blind injection via CASE" do
      assert {:error, _} =
               Parser.validate_order_by(
                 ~s|CASE WHEN (SELECT count(*) FROM pg_roles) > 5 THEN 1 ELSE 0 END|,
                 @columns
               )
    end

    test "rejects nested function calls" do
      assert {:error, _} = Parser.validate_order_by(~s|lower(upper(value))|, @columns)
    end

    test "rejects coalesce and other conditional functions" do
      assert {:error, _} = Parser.validate_order_by(~s|coalesce(value, 'default')|, @columns)
    end

    test "rejects arithmetic expressions without subqueries" do
      assert {:error, _} = Parser.validate_order_by(~s|id + 1|, @columns)
    end

    test "rejects string concatenation operator" do
      assert {:error, _} = Parser.validate_order_by(~s(value || 'suffix'), @columns)
    end

    test "rejects IS NULL / IS NOT NULL expressions" do
      # Plain column ordering is fine, but expressions wrapping columns should not be
      # NullTest on a column ref could be debatable, but the fix rejects it
      assert {:error, _} = Parser.validate_order_by(~s|value IS NULL|, @columns)
    end

    test "accepts quoted column names" do
      columns = [%{name: "id"}, %{name: "My Column"}]
      assert {:ok, _} = Parser.validate_order_by(~s|"My Column" ASC|, columns)
    end

    test "accepts multiple columns with mixed directions" do
      assert {:ok, _} =
               Parser.validate_order_by(
                 ~s|id DESC NULLS FIRST, value ASC NULLS LAST|,
                 @columns
               )
    end

    test "accepts constant for tie-breaking" do
      assert {:ok, _} = Parser.validate_order_by(~s|id ASC, 1|, @columns)
    end
  end

  describe "parse_and_validate_expression/3 with parameters" do
    test "uses parameters and save a parsed value" do
      assert {:ok, %Expr{eval: result, query: query}} =
               Parser.parse_and_validate_expression(~S|'{1,2}'::int[] @> $1|,
                 params: %{"1" => "{2}"},
                 refs: %{
                   ["id"] => {:array, :int8}
                 }
               )

      assert query == ~S|'{1,2}'::int[] @> '{2}'::int4[]|

      assert %Const{value: true, type: :bool} = result

      assert {:ok, %Expr{eval: result, query: query}} =
               Parser.parse_and_validate_expression(~S|1 > $1|,
                 params: %{"1" => "0"},
                 refs: %{
                   ["id"] => {:array, :int8}
                 }
               )

      assert %Const{value: true, type: :bool} = result
      assert query == ~S|1 > '0'::int4|
    end

    test "fails if parameters can't resolve to same type" do
      assert {:error, "At location 16: invalid syntax for type int4: test"} =
               Parser.parse_and_validate_expression(~S"$1 > 5 AND $1 + 'test' > 10",
                 params: %{"1" => "1"}
               )
    end

    test "fails if one of parameters is not provided" do
      assert {:error, "At location 0: parameter $1 was not provided"} =
               Parser.parse_and_validate_expression(~S"$1 > 5")
    end

    test "subquery with parameters is correctly interpolated" do
      assert {:ok,
              %Expr{
                query:
                  ~S|value IN (SELECT value FROM project WHERE value > '5'::int4) AND value > '10'::int4|
              }} =
               Parser.parse_and_validate_expression(
                 ~S|value IN (SELECT value FROM project WHERE value > $1) AND value > $2|,
                 refs: %{["$sublink", "0"] => {:array, :int4}, ["value"] => :int4},
                 params: %{"1" => "5", "2" => "10"},
                 sublink_queries: %{0 => ~S|SELECT value FROM project WHERE value > '5'::int4|}
               )
    end
  end
end
