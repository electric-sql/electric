defmodule Electric.Replication.Eval.RunnerTest do
  use ExUnit.Case, async: true
  use ExUnitProperties

  alias Electric.Replication.Eval.Runner
  alias Electric.Replication.Eval.Parser

  describe "record_to_ref_values/3" do
    test "should build ref values from record with known types and nils" do
      refs = %{
        ["string"] => :text,
        ["int"] => :int4,
        ["null_int"] => :int4
      }

      assert {:ok,
              %{
                ["string"] => "test",
                ["int"] => 5,
                ["null_int"] => nil
              }} ==
               Runner.record_to_ref_values(refs, %{
                 "string" => "test",
                 "int" => "5",
                 "null_int" => nil
               })
    end
  end

  describe "execute/2" do
    test "should correctly execute constant expressions" do
      assert {:ok, true} =
               ~S"1::boolean"
               |> Parser.parse_and_validate_expression!()
               |> Runner.execute(%{})
    end

    test "should correctly take refs" do
      assert {:ok, true} =
               ~S|"test"|
               |> Parser.parse_and_validate_expression!(refs: %{["test"] => :bool})
               |> Runner.execute(%{["test"] => true})
    end

    test "should correctly apply functions" do
      assert {:ok, 2} =
               ~S|"test" + 1|
               |> Parser.parse_and_validate_expression!(refs: %{["test"] => :int4})
               |> Runner.execute(%{["test"] => 1})
    end

    test "should not apply strict functions to nil values" do
      assert {:ok, nil} =
               ~S|"test" + 1|
               |> Parser.parse_and_validate_expression!(refs: %{["test"] => :int4})
               |> Runner.execute(%{["test"] => nil})
    end

    test "should return error on invalid function application instead of crashing" do
      assert {:error, %{args: ["test", 1]}} =
               ~S|"test" + 1|
               |> Parser.parse_and_validate_expression!(refs: %{["test"] => :int4})
               |> Runner.execute(%{["test"] => "test"})
    end

    test "can evaluate AND expression with multiple conditions" do
      assert {:ok, true} =
               ~S|test > 1 AND test = 2 AND test < 3|
               |> Parser.parse_and_validate_expression!(refs: %{["test"] => :int4})
               |> Runner.execute(%{["test"] => 2})
    end

    test "can evaluate OR expression with nil values" do
      for {foo, bar} <- [{1, nil}, {nil, 1}] do
        assert {:ok, true} =
                 ~S|foo = 1 OR bar = 1|
                 |> Parser.parse_and_validate_expression!(
                   refs: %{["foo"] => :int4, ["bar"] => :int4}
                 )
                 |> Runner.execute(%{["foo"] => foo, ["bar"] => bar})
      end

      for {foo, bar} <- [{2, nil}, {nil, 2}] do
        assert {:ok, nil} =
                 ~S|foo = 1 OR bar = 1|
                 |> Parser.parse_and_validate_expression!(
                   refs: %{["foo"] => :int4, ["bar"] => :int4}
                 )
                 |> Runner.execute(%{["foo"] => foo, ["bar"] => bar})
      end
    end

    test "can evaluate IN expression with nil values" do
      assert {:ok, true} =
               ~S|1 IN (NULL, 1)|
               |> Parser.parse_and_validate_expression!()
               |> Runner.execute(%{})

      assert {:ok, nil} =
               ~S|2 IN (1, NULL)|
               |> Parser.parse_and_validate_expression!()
               |> Runner.execute(%{})

      assert {:ok, nil} =
               ~S|NULL IN (NULL, 1)|
               |> Parser.parse_and_validate_expression!()
               |> Runner.execute(%{})
    end

    test "should work with array types" do
      assert {:ok, [[1, 2], [3, 4]]} =
               ~S|ARRAY[ARRAY[1, x], ARRAY['3', 2 + 2]]|
               |> Parser.parse_and_validate_expression!(refs: %{["x"] => :int4})
               |> Runner.execute(%{["x"] => 2})

      assert {:ok, true} =
               ~S|x @> ARRAY[y]|
               |> Parser.parse_and_validate_expression!(
                 refs: %{
                   ["x"] => {:array, :int4},
                   ["y"] => :int4
                 }
               )
               |> Runner.execute(%{["y"] => 1, ["x"] => [1, 2]})

      assert {:ok, nil} =
               ~S|x @> ARRAY['value']|
               |> Parser.parse_and_validate_expression!(
                 refs: %{
                   ["x"] => {:array, :text}
                 }
               )
               |> Runner.execute(%{["x"] => nil})

      assert {:ok, nil} =
               ~S|x @> ARRAY[y]|
               |> Parser.parse_and_validate_expression!(
                 refs: %{
                   ["x"] => {:array, :int4},
                   ["y"] => :int4
                 }
               )
               |> Runner.execute(%{["y"] => 1, ["x"] => nil})

      assert {:ok, true} =
               ~S|x::float[] = y::int4[]::float[]|
               |> Parser.parse_and_validate_expression!(
                 refs: %{
                   ["x"] => {:array, :int4},
                   ["y"] => :text
                 }
               )
               |> Runner.execute(%{["y"] => "{1,2}", ["x"] => [1, 2]})

      assert {:ok, true} =
               ~S|y = ANY (x)|
               |> Parser.parse_and_validate_expression!(
                 refs: %{
                   ["x"] => {:array, :int4},
                   ["y"] => :int8
                 }
               )
               |> Runner.execute(%{["y"] => 1, ["x"] => [1, 2]})

      assert {:ok, [[1, 2], [3, 4]]} =
               ~S/(ARRAY[1] || ARRAY[2]) || x/
               |> Parser.parse_and_validate_expression!(
                 refs: %{
                   ["x"] => {:array, :float8}
                 }
               )
               |> Runner.execute(%{["x"] => [[3, 4]]})

      assert {:error, _} =
               ~S/(ARRAY[1] || ARRAY[2]) || x/
               |> Parser.parse_and_validate_expression!(
                 refs: %{
                   ["x"] => {:array, :int4}
                 }
               )
               |> Runner.execute(%{["x"] => [[[3, 4]]]})
    end
  end

  describe "execute/2 property test" do
    import Support.ComponentSetup
    import Support.DbSetup
    import StreamData

    setup [:with_unique_db]

    property "PostgreSQL clause behaves the same in both implementations", %{pool: pool} do
      check all(
              clause <- clause_generator(),
              max_runs: 1000
            ) do
        assert_runner_and_oracle_match(clause, pool)
      end
    end

    defp execute_oracle(clause, db_conn) do
      oracle_result =
        case Postgrex.query(db_conn, "SELECT #{clause}", []) do
          {:ok, %Postgrex.Result{rows: [[result]]}} -> {:ok, result}
          {:error, %Postgrex.Error{postgres: %{message: reason}}} -> {:error, reason}
        end
    end

    defp execute_runner(clause) do
      runner_result =
        try do
          clause
          |> Parser.parse_and_validate_expression!()
          |> Runner.execute(%{})
        rescue
          err -> {:error, err}
        end
    end

    defp assert_runner_and_oracle_match(clause, db_conn) do
      oracle_result = execute_oracle(clause, db_conn)
      runner_result = execute_runner(clause)

      case {runner_result, oracle_result} do
        {{:ok, runner_val}, {:ok, oracle_val}} ->
          # Both results are ok, we can compare them
          oracle_val = cast_decimals_to_floats(oracle_val)

          case oracle_val do
            val when is_number(oracle_val) and is_number(runner_val) ->
              assert_in_delta(runner_val, oracle_val, abs(0.01 * oracle_val))

            _ ->
              assert runner_val == oracle_val,
                     """
                     MISMATCH!

                     SQL: #{clause}

                     runner returned: #{inspect(runner_val)}
                     oracle returned: #{inspect(oracle_val)}
                     """
          end

          :ok

        {{:error, _}, {:error, _}} ->
          # Both results are errors - which is fine
          :ok

        {{:ok, nil}, {:error, _}} ->
          # Runner coalescing to nil rather than erroring is not ideal,
          # but we can live with it
          :ok

        {{:ok, _}, {:error, "value out of range:" <> _}} ->
          # We are fine with being able to handle values the oracle cannot
          :ok

        {{:ok, _}, {:error, "integer out of range"}} ->
          # We are fine with being able to handle values the oracle cannot
          :ok

        {{:error, err}, {:ok, _}} ->
          raise "Runner error: #{inspect(err)} for clause: #{clause}"

        {{:ok, _}, {:error, err}} ->
          raise "Oracle error: #{inspect(err)} for clause: #{clause}"
      end
    end

    defp cast_decimals_to_floats(value) when is_list(value) do
      Enum.map(value, &cast_decimals_to_floats/1)
    end

    defp cast_decimals_to_floats(%Decimal{} = decimal), do: Decimal.to_float(decimal)
    defp cast_decimals_to_floats(value), do: value

    ## TYPE GENERATORS

    defp null_gen, do: constant("NULL")
    defp bool_gen, do: member_of(["TRUE", "FALSE"])

    defp int_gen, do: integer() |> map(&Integer.to_string/1)
    defp pos_int_gen, do: positive_integer() |> map(&Integer.to_string/1)
    defp double_gen, do: float(min: -1.0e6, max: 1.0e6) |> map(&Float.to_string/1)
    defp numeric_gen, do: one_of([int_gen(), double_gen()])

    defp str_gen,
      do:
        StreamData.string(:ascii, max_length: 10)
        |> map(&"'#{String.replace(&1, "'", "''")}'")

    defp array_gen(type_gen, opts \\ []) do
      dimension = Access.get(opts, :dimension, 1)
      min_length = Access.get(opts, :min_length, 1)
      max_length = Access.get(opts, :max_length, 5)

      Enum.reduce(1..dimension, type_gen, fn dim, gen ->
        list_gen =
          if dim == dimension do
            list_of(gen, min_length: min_length, max_length: max_length)
          else
            list_of(gen, length: Enum.random(min_length..max_length))
          end

        list_gen
        |> map(fn elements ->
          "ARRAY[" <> Enum.join(elements, ", ") <> "]"
        end)
      end)
    end

    defp datatype_gen_func do
      member_of([int_gen(), double_gen(), bool_gen(), str_gen()])
      |> map(&nullable_type_gen/1)
    end

    defp nullable_type_gen(type_gen, null_ratio \\ 0.25),
      do: frequency([{floor(1.0 / null_ratio), type_gen}, {1, null_gen()}])

    ## OPERATION GENERATORS

    defp comparison_op_gen,
      do:
        member_of([
          "=",
          "!=",
          "<>",
          ">",
          "<",
          ">=",
          "<=",
          "IS DISTINCT FROM",
          "IS NOT DISTINCT FROM"
        ])

    defp bool_comparison_op_gen, do: member_of(["AND", "OR"])
    defp bool_unary_op_gen, do: constant("NOT")

    defp range_comparison_op_gen,
      do: member_of(["BETWEEN", "BETWEEN SYMMETRIC"]) |> with_negation()

    defp array_op_gen, do: member_of(["||"])
    defp string_function_op_gen, do: member_of(["LOWER", "UPPER"])
    defp array_comparison_op_gen, do: member_of(["@>", "<@", "&&"])

    defp numeric_op_gen, do: member_of(["+", "-", "/", "*"])
    defp numeric_unary_op_gen, do: member_of(["+", "-", "@"])
    defp int_op_gen, do: one_of([numeric_op_gen(), member_of(["&", "|", "#"])])
    defp int_unary_op_gen, do: one_of([numeric_unary_op_gen(), member_of(["~"])])
    defp double_unary_op_gen, do: one_of([numeric_unary_op_gen(), member_of(["|/"])])

    defp string_op_gen, do: member_of(["||"])
    defp string_comparison_op_gen, do: member_of(["~~", "~~*", "!~~", "!~~*"])
    defp string_function_op_gen, do: member_of(["LOWER", "UPPER"])

    defp membership_op_gen, do: with_negation(constant("IN"))

    defp is_null_op_gen, do: null_gen() |> map(&"IS #{&1}")

    defp predicate_op_gen,
      do: one_of([bool_gen(), constant("UNKNOWN"), null_gen()]) |> map(&"IS #{&1}")

    ## OPERATION COMPOSITION UTILITIES

    defp with_negation(op_gen), do: one_of([op_gen, map(op_gen, &"NOT #{&1}")])

    defp compose_unary_op(type_gen, unary_op_gen),
      do: bind({type_gen, unary_op_gen}, fn {a, unary_op} -> constant("#{unary_op} #{a}") end)

    defp compose_predicate_op(type_gen, predicate_op_gen),
      do:
        bind({type_gen, predicate_op_gen}, fn {a, predicate_op} ->
          constant("#{a} #{predicate_op}")
        end)

    defp compose_op(type_gen, op_gen),
      do: bind({type_gen, op_gen, type_gen}, fn {a, op, b} -> constant("#{a} #{op} #{b}") end)

    defp compose_range_op(type_gen, range_op_gen),
      do:
        bind({type_gen, range_op_gen, type_gen, type_gen}, fn {a, range_op, b, c} ->
          constant("#{a} #{range_op} #{b} AND #{c}")
        end)

    defp compose_function_op(type_gen, op_gen) do
      bind({type_gen, op_gen}, fn {val, op} -> constant("#{op}(#{val})") end)
    end

    defp compose_membership_op(type_gen, op_gen, opts \\ []) do
      min_length = Access.get(opts, :min_length, 1)
      max_length = Access.get(opts, :max_length, 5)

      bind(
        {
          type_gen,
          op_gen,
          list_of(type_gen, min_length: min_length, max_length: max_length)
        },
        fn {val, op, values} -> constant("#{val} #{op} (#{Enum.join(values, ", ")})") end
      )
    end

    ## EXPRESSION GENERATORS

    defp expression_gen(type_gen, op_generators) do
      type_gen = nullable_type_gen(type_gen)

      op_generators
      |> Enum.concat([
        # {:comparison_op, comparison_op_gen()},
        {:unary_op, is_null_op_gen()}
        # {:range_op, range_comparison_op_gen()},
        # {:membership_op, membership_op_gen()}
      ])
      |> Enum.map(fn
        {:combine_op, op_gen} -> compose_op(type_gen, op_gen)
        {:comparison_op, op_gen} -> compose_op(type_gen, op_gen)
        {:unary_op, op_gen} -> compose_unary_op(type_gen, op_gen)
        {:predicate_op, op_gen} -> compose_predicate_op(type_gen, op_gen)
        {:range_op, op_gen} -> compose_range_op(type_gen, op_gen)
        {:membership_op, op_gen} -> compose_membership_op(type_gen, op_gen)
        {:function_op, op_gen} -> compose_function_op(type_gen, op_gen)
      end)
      |> one_of()
    end

    defp nested_expression_gen(type_gen, ops, opts \\ []) do
      max_nesting = Access.get(opts, :max_nesting, 3)

      Enum.map(1..max_nesting, fn nest_level ->
        Enum.reduce(1..nest_level, type_gen, fn _, gen ->
          expression_gen(gen |> map(&"(#{&1})"), ops)
        end)
      end)
      |> one_of
    end

    defp numeric_expression_gen do
      one_of([
        expression_gen(numeric_gen() |> nullable_type_gen(), [
          {:combine_op, numeric_op_gen()},
          {:unary_op, numeric_unary_op_gen()},
          {:range_op, range_comparison_op_gen()}
        ]),
        expression_gen(int_gen() |> nullable_type_gen(), [
          {:combine_op, int_op_gen()},
          {:unary_op, int_unary_op_gen()},
          {:range_op, range_comparison_op_gen()}
        ]),
        expression_gen(double_gen() |> nullable_type_gen(), [
          {:combine_op, numeric_op_gen()},
          {:unary_op, double_unary_op_gen()},
          {:range_op, range_comparison_op_gen()}
        ])
      ])
    end

    defp string_expression_gen do
      expression_gen(str_gen() |> nullable_type_gen(), [
        {:combine_op, string_op_gen()},
        {:function_op, string_function_op_gen()},
        {:comparison_op, string_comparison_op_gen()},
        {:range_op, range_comparison_op_gen()}
      ])
    end

    defp bool_expression_gen do
      expression_gen(bool_gen() |> nullable_type_gen(), [
        {:comparison_op, bool_comparison_op_gen()},
        {:unary_op, bool_unary_op_gen()},
        {:predicate_op, predicate_op_gen()}
      ])
    end

    defp array_expression_gen(opts \\ []) do
      max_dimensions = Access.get(opts, :max_dimensions, 3)

      Enum.zip(
        [int_gen(), double_gen(), bool_gen(), str_gen()]
        |> Enum.map(&nullable_type_gen/1),
        1..max_dimensions
      )
      |> Enum.map(fn {type_gen, dim} -> {type_gen, array_gen(type_gen, dimension: dim)} end)
      |> Enum.flat_map(fn {type_gen, array_type_gen} ->
        [
          expression_gen(array_type_gen, [
            {:combine_op, array_op_gen()},
            {:comparison_op, array_comparison_op_gen()}
          ]),
          bind({array_type_gen, nullable_type_gen(type_gen)}, fn {array, element} ->
            one_of([
              constant("array_append(#{array}, #{element})"),
              constant("array_prepend(#{element}, #{array})"),
              constant("#{array} || #{element}"),
              constant("#{element} || #{array}")
            ])
          end)
        ]
      end)
      |> one_of
    end

    defp combine_to_bool_expression(type_gen, comparison_ops \\ []) do
      expression_gen(
        type_gen,
        [
          {:comparison_op, comparison_op_gen()},
          {:unary_op, is_null_op_gen()},
          {:range_op, range_comparison_op_gen()},
          {:membership_op, membership_op_gen()}
        ]
        |> Enum.concat(comparison_ops)
      )
    end

    defp datatype_expression_gen() do
      [
        numeric_expression_gen(),
        string_expression_gen(),
        bool_expression_gen(),
        array_expression_gen()
      ]
      |> one_of()
    end

    defp clause_generator do
      datatype_expression_gen()
    end
  end
end
