defmodule Electric.Replication.Eval.ParserTest do
  use ExUnit.Case, async: true

  alias Electric.Replication.Eval.Env.ExplicitCasts
  alias Electric.Replication.Eval.Parser
  alias Electric.Replication.Eval.Parser.{Const, Func, Ref}
  alias Electric.Replication.Eval.Env
  alias Electric.Replication.Eval.Expr

  @int_to_bool_casts %{
    {:int4, :bool} => {ExplicitCasts, :int4_to_bool},
    {:bool, :int4} => {ExplicitCasts, :bool_to_int4}
  }

  describe "parse_and_validate_expression/3 basics" do
    test "should correctly parse constants" do
      assert {:ok, %Expr{eval: result}} = Parser.parse_and_validate_expression("TRUE")
      assert %Const{value: true} = result
    end

    test "should work with unknown constants" do
      assert {:ok, %Expr{eval: result}} = Parser.parse_and_validate_expression("'test'")
      assert %Const{value: "test", type: :text} = result
    end

    test "should correctly parse type casts on constants" do
      assert {:error, "At location 0: unknown cast from type int4 to type bool"} =
               Parser.parse_and_validate_expression("1::boolean", %{}, Env.empty())
    end

    test "should fail on references that don't exist" do
      assert {:error, "At location 0: unknown reference test"} =
               Parser.parse_and_validate_expression(~S|"test"|, %{})
    end

    test "should fail helpfully on references that might exist" do
      assert {:error, "At location 0: unknown reference test - did you mean `this.test`?"} =
               Parser.parse_and_validate_expression(~S|"test"|, %{["this", "test"] => :bool})
    end

    test "should correctly parse a known reference" do
      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(~S|"test"|, %{["test"] => :bool})

      assert %Ref{path: ["test"], type: :bool} = result
    end

    test "should correctly parse a boolean function" do
      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(~S|"test" OR true|, %{["test"] => :bool})

      assert %Func{name: "or", args: [%Ref{path: ["test"], type: :bool}, %Const{value: true}]} =
               result
    end

    test "should correctly parse a cast on reference" do
      env = Env.empty(explicit_casts: @int_to_bool_casts)

      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(
                 ~S|"test"::integer|,
                 %{["test"] => :bool},
                 env
               )

      assert %Func{name: "bool_to_int4", args: [%Ref{path: ["test"], type: :bool}]} = result
    end

    test "should correctly cast a const at compile time" do
      env = Env.empty(explicit_casts: @int_to_bool_casts)

      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(~S|true::integer|, %{["test"] => :bool}, env)

      assert %Const{type: :int4, value: 1} = result
    end

    test "should correctly process a cast chain" do
      env = Env.empty(explicit_casts: @int_to_bool_casts)

      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(
                 ~S|true::integer::bool::integer::bool::integer|,
                 %{},
                 env
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
               Parser.parse_and_validate_expression(~S|- "test"|, %{["test"] => :int4}, env)

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
                 %{["test"] => :int4},
                 env
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
               Parser.parse_and_validate_expression(~S|"test" + '4'|, %{["test"] => :int4}, env)

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
               Parser.parse_and_validate_expression(~S|"test" + '4'|, %{["test"] => :int4}, env)

      assert %Func{
               name: "float8",
               args: [%Ref{path: ["test"], type: :int4}, %Const{type: :float8, value: 4.0}]
             } = result
    end

    test "should fail on a function with aggregation" do
      assert {:error, "At location 0: aggregation is not supported in this context"} =
               Parser.parse_and_validate_expression(~S|ceil(DISTINCT "test")|, %{
                 ["test"] => :int4
               })
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
               Parser.parse_and_validate_expression(~S|ceil("test")|, %{["test"] => :int4}, env)

      assert %Func{name: "-", args: [%Ref{path: ["test"], type: :int4}]} = result
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
               Parser.parse_and_validate_expression(~S|1 + 1|, %{["test"] => :int4}, env)

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
                 %{["test"] => :int4},
                 env
               )

      assert %Const{value: ~N[2024-01-01 20:00:00], type: :timestamp} = result
    end

    test "should work with IS DISTINCT FROM clauses" do
      env =
        Env.empty(
          operators: %{
            {~s|"="|, 2} => [
              %{args: [:int4, :int4], returns: :bool, implementation: & &1, name: "="}
            ]
          }
        )

      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(
                 ~S|1 IS DISTINCT FROM NULL|,
                 %{["test"] => :int4},
                 env
               )

      assert %Const{value: true, type: :bool} = result
    end

    test "should work with LIKE clauses" do
      env =
        Env.new()

      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(
                 ~S|'hello' NOT LIKE 'hell\%' AND 'hello' LIKE 'h%o' |,
                 %{},
                 env
               )

      assert %Const{value: true, type: :bool} = result
    end

    test "should work with explicit casts" do
      env = Env.new()

      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(~S|1::boolean|, %{}, env)

      assert %Const{value: true, type: :bool} = result
    end

    test "casting uuid to text" do
      assert {:ok, _} =
               Parser.parse_and_validate_expression(
                 ~S|(new.is_valid) AND (new.user_id::text = auth.user_id)|,
                 %{
                   ["new", "user_id"] => :uuid,
                   ["new", "is_valid"] => :bool,
                   ["auth", "user_id"] => :text
                 }
               )
    end

    test "float[48] / float8" do
      assert {:ok, _} =
               Parser.parse_and_validate_expression(
                 ~S|new.percent / 100.0 > 0.3|,
                 %{
                   ["new", "percent"] => :float8
                 }
               )

      assert {:ok, _} =
               Parser.parse_and_validate_expression(
                 ~S|new.percent / 100.0 > 0.3|,
                 %{
                   ["new", "percent"] => :float4
                 }
               )
    end

    test "should work with IN clauses" do
      env = Env.new()

      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(~S|1 IN (1, 2, 3)|, %{}, env)

      assert %Const{value: true, type: :bool} = result
    end

    test "should work with NOT IN clauses" do
      env = Env.new()

      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(
                 ~S|'test' NOT IN ('hello', 'world')|,
                 %{},
                 env
               )

      assert %Const{value: true, type: :bool} = result
    end

    test "should work with IN clauses when one of the options is NULL (by converting everything to NULL)" do
      # https://www.postgresql.org/docs/current/functions-comparisons.html#FUNCTIONS-COMPARISONS-IN-SCALAR
      env = Env.new()

      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(
                 ~S|'test' IN ('hello', NULL)|,
                 %{},
                 env
               )

      assert %Const{value: nil, type: :bool} = result
    end

    test "should not allow subqueries in IN clauses" do
      env = Env.new()

      assert {:error, "At location 5: subqueries are not supported"} =
               Parser.parse_and_validate_expression(
                 ~S|test IN (SELECT val FROM tester)|,
                 %{["test"] => :int4},
                 env
               )
    end

    test "should support complex operations with dates" do
      env = Env.new()

      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(
                 ~S|date '2024-01-01' < interval '1 month 1 hour' + date '2023-12-01'|,
                 %{},
                 env
               )

      assert %Const{value: true, type: :bool} = result
    end

    test "should support `AT TIME ZONE`" do
      env = Env.new()

      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(
                 ~S|timestamp '2001-02-16 20:38:40' at time zone 'America/Denver' = '2001-02-17 03:38:40+00'|,
                 %{},
                 env
               )

      assert %Const{value: true, type: :bool} = result

      assert {:ok, %Expr{eval: result}} =
               Parser.parse_and_validate_expression(
                 ~S|timestamp with time zone '2001-02-16 20:38:40+03' at time zone 'America/Denver' = '2001-02-16 10:38:40'|,
                 %{},
                 env
               )

      assert %Const{value: true, type: :bool} = result
    end
  end
end
