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
  end
end
