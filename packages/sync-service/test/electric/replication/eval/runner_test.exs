defmodule Electric.Replication.Eval.RunnerTest do
  use ExUnit.Case, async: true
  use ExUnitProperties

  import Support.DbSetup

  alias Electric.Replication.Eval.Runner
  alias Electric.Replication.Eval.Parser
  alias Support.PgExpressionGenerator

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

    test "supports coalesce as a variadic function" do
      expr =
        ~S|coalesce("value", 'fallback', 'unused')|
        |> Parser.parse_and_validate_expression!(refs: %{["value"] => :text})

      assert {:ok, "fallback"} = Runner.execute(expr, %{["value"] => nil})
      assert {:ok, "present"} = Runner.execute(expr, %{["value"] => "present"})
    end

    test "coalesce short-circuits later arguments" do
      expr =
        ~S|coalesce("value", 1 / "divisor")|
        |> Parser.parse_and_validate_expression!(
          refs: %{["value"] => :int4, ["divisor"] => :int4}
        )

      assert {:ok, 10} = Runner.execute(expr, %{["value"] => 10, ["divisor"] => 0})

      assert {:error, _} =
               Runner.execute(expr, %{["value"] => nil, ["divisor"] => 0})
    end

    test "coalesce skips unreachable constant branches after a non-null fallback" do
      expr =
        ~S|coalesce("value", 1, 1 / "divisor")|
        |> Parser.parse_and_validate_expression!(
          refs: %{["value"] => :int4, ["divisor"] => :int4}
        )

      assert {:ok, 1} = Runner.execute(expr, %{["value"] => nil, ["divisor"] => 0})
    end

    test "supports greatest as a variadic function and ignores nil arguments" do
      expr =
        ~S|greatest("value", 2, 3, NULL::int4)|
        |> Parser.parse_and_validate_expression!(refs: %{["value"] => :int4})

      assert {:ok, 3} = Runner.execute(expr, %{["value"] => nil})
      assert {:ok, 4} = Runner.execute(expr, %{["value"] => 4})

      assert {:ok, nil} =
               ~S|greatest(NULL::int4, NULL::int4)|
               |> Parser.parse_and_validate_expression!()
               |> Runner.execute(%{})
    end

    test "supports least as a variadic function for datetime values" do
      expr =
        ~S|least("value", date '2024-01-02', NULL::date)|
        |> Parser.parse_and_validate_expression!(refs: %{["value"] => :date})

      assert {:ok, ~D[2024-01-02]} = Runner.execute(expr, %{["value"] => nil})
      assert {:ok, ~D[2024-01-01]} = Runner.execute(expr, %{["value"] => ~D[2024-01-01]})

      assert {:ok, nil} =
               ~S|least(NULL::date, NULL::date)|
               |> Parser.parse_and_validate_expression!()
               |> Runner.execute(%{})
    end

    test "supports concat as a variadic text function, skipping NULL arguments" do
      assert {:ok, "ab"} =
               ~S|concat('a', 'b')|
               |> Parser.parse_and_validate_expression!()
               |> Runner.execute(%{})

      assert {:ok, "ab"} =
               ~S|concat('a', NULL::text, 'b')|
               |> Parser.parse_and_validate_expression!()
               |> Runner.execute(%{})

      assert {:ok, ""} =
               ~S|concat(NULL::text, NULL::text)|
               |> Parser.parse_and_validate_expression!()
               |> Runner.execute(%{})

      expr =
        ~S|concat('x', "mid", 'z')|
        |> Parser.parse_and_validate_expression!(refs: %{["mid"] => :text})

      assert {:ok, "xbz"} = Runner.execute(expr, %{["mid"] => "b"})
      assert {:ok, "xz"} = Runner.execute(expr, %{["mid"] => nil})

      assert {:ok, true} =
               ~S|ilike(concat('%', "value", '%'), '%foo%')|
               |> Parser.parse_and_validate_expression!(refs: %{["value"] => :text})
               |> Runner.execute(%{["value"] => "foo"})

      assert {:ok, nil} =
               ~S{'a' || NULL::text || 'b'}
               |> Parser.parse_and_validate_expression!()
               |> Runner.execute(%{})
    end

    test "concat() with zero arguments is not a supported overload" do
      assert {:error, msg} = Parser.parse_and_validate_expression(~S|concat()|)
      assert msg =~ "unknown or unsupported function concat/0"
    end

    test "subquery" do
      assert {:ok, true} =
               ~S|test IN (SELECT val FROM tester)|
               |> Parser.parse_and_validate_expression!(
                 refs: %{["test"] => :int4, ["$sublink", "0"] => {:array, :int4}},
                 sublink_queries: %{0 => "SELECT val FROM tester"}
               )
               |> Runner.execute(%{["test"] => 4, ["$sublink", "0"] => MapSet.new([2, 3, 4])})
    end

    test "subquery with callback-backed membership" do
      expr =
        ~S|test IN (SELECT val FROM tester)|
        |> Parser.parse_and_validate_expression!(
          refs: %{["test"] => :int4, ["$sublink", "0"] => {:array, :int4}},
          sublink_queries: %{0 => "SELECT val FROM tester"}
        )

      subquery_member? = fn
        ["$sublink", "0"], 4 -> true
        ["$sublink", "0"], _ -> false
      end

      assert {:ok, true} =
               Runner.execute(expr, %{["test"] => 4}, subquery_member?: subquery_member?)

      assert {:ok, false} =
               Runner.execute(expr, %{["test"] => 5}, subquery_member?: subquery_member?)
    end

    test "subquery with row expression" do
      assert {:ok, true} =
               ~S|(test1, test2) IN (SELECT val1, val2 FROM tester)|
               |> Parser.parse_and_validate_expression!(
                 refs: %{
                   ["test1"] => :int4,
                   ["test2"] => :int4,
                   ["$sublink", "0"] => {:array, {:row, [:int4, :int4]}}
                 },
                 sublink_queries: %{0 => "SELECT val1, val2 FROM tester"}
               )
               |> Runner.execute(%{
                 ["test1"] => 4,
                 ["test2"] => 5,
                 ["$sublink", "0"] => MapSet.new([{2, 3}, {4, 5}])
               })
    end
  end

  describe "execute/2 against PG results" do
    setup [:with_shared_db]

    @max_runs 10_000
    @max_run_time 1_000

    property "numeric expressions", %{pool: pool} do
      check all(
              clause <- PgExpressionGenerator.numeric_expression(),
              max_runs: @max_runs,
              max_run_time: @max_run_time
            ) do
        assert_runner_and_oracle_match(clause, pool)
      end
    end

    property "string expressions", %{pool: pool} do
      check all(
              clause <- PgExpressionGenerator.string_expression(),
              max_runs: @max_runs,
              max_run_time: @max_run_time
            ) do
        assert_runner_and_oracle_match(clause, pool)
      end
    end

    property "bool expressions", %{pool: pool} do
      check all(
              clause <- PgExpressionGenerator.bool_expression(),
              max_runs: @max_runs,
              max_run_time: @max_run_time
            ) do
        assert_runner_and_oracle_match(clause, pool)
      end
    end

    property "complex bool expressions", %{pool: pool} do
      check all(
              clause <- PgExpressionGenerator.complex_bool_expression(),
              max_runs: @max_runs,
              max_run_time: @max_run_time
            ) do
        assert_runner_and_oracle_match(clause, pool)
      end
    end

    property "array expressions", %{pool: pool} do
      check all(
              clause <- PgExpressionGenerator.array_expression(),
              max_runs: @max_runs,
              max_run_time: @max_run_time
            ) do
        assert_runner_and_oracle_match(clause, pool)
      end
    end

    defp execute_oracle(clause, db_conn) do
      case Postgrex.query(db_conn, "SELECT #{clause}", []) do
        {:ok, %Postgrex.Result{rows: [[result]]}} -> {:ok, result}
        {:error, %Postgrex.Error{postgres: %{message: reason}}} -> {:error, reason}
      end
    end

    defp execute_runner(clause) do
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

          if is_number(oracle_val) do
            assert_in_delta(runner_val, oracle_val, abs(0.01 * oracle_val))
          else
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
  end
end
