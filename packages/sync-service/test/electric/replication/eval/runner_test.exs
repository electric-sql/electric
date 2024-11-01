defmodule Electric.Replication.Eval.RunnerTest do
  use ExUnit.Case, async: true

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
               |> Parser.parse_and_validate_expression!(%{["test"] => :bool})
               |> Runner.execute(%{["test"] => true})
    end

    test "should correctly apply functions" do
      assert {:ok, 2} =
               ~S|"test" + 1|
               |> Parser.parse_and_validate_expression!(%{["test"] => :int4})
               |> Runner.execute(%{["test"] => 1})
    end

    test "should not apply strict functions to nil values" do
      assert {:ok, nil} =
               ~S|"test" + 1|
               |> Parser.parse_and_validate_expression!(%{["test"] => :int4})
               |> Runner.execute(%{["test"] => nil})
    end

    test "should return error on invalid function application instead of crashing" do
      assert {:error, %{args: ["test", 1]}} =
               ~S|"test" + 1|
               |> Parser.parse_and_validate_expression!(%{["test"] => :int4})
               |> Runner.execute(%{["test"] => "test"})
    end

    test "should work with array types" do
      assert {:ok, [[1, 2], [3, 4]]} =
               ~S|ARRAY[ARRAY[1, x], ARRAY['3', 2 + 2]]|
               |> Parser.parse_and_validate_expression!(%{["x"] => :int4})
               |> Runner.execute(%{["x"] => 2})

      assert {:ok, true} =
               ~S|x @> ARRAY[y]|
               |> Parser.parse_and_validate_expression!(%{
                 ["x"] => {:array, :int4},
                 ["y"] => :int4
               })
               |> Runner.execute(%{["y"] => 1, ["x"] => [1, 2]})

      assert {:ok, nil} =
               ~S|x @> ARRAY['value']|
               |> Parser.parse_and_validate_expression!(%{
                 ["x"] => {:array, :text}
               })
               |> Runner.execute(%{["x"] => nil})

      assert {:ok, nil} =
               ~S|x @> ARRAY[y]|
               |> Parser.parse_and_validate_expression!(%{
                 ["x"] => {:array, :int4},
                 ["y"] => :int4
               })
               |> Runner.execute(%{["y"] => 1, ["x"] => nil})

      assert {:ok, true} =
               ~S|x::float[] = y::int4[]::float[]|
               |> Parser.parse_and_validate_expression!(%{
                 ["x"] => {:array, :int4},
                 ["y"] => :text
               })
               |> Runner.execute(%{["y"] => "{1,2}", ["x"] => [1, 2]})

      assert {:ok, true} =
               ~S|y = ANY (x)|
               |> Parser.parse_and_validate_expression!(%{
                 ["x"] => {:array, :int4},
                 ["y"] => :int8
               })
               |> Runner.execute(%{["y"] => 1, ["x"] => [1, 2]})

      assert {:ok, [[1, 2], [3, 4]]} =
               ~S/(ARRAY[1] || ARRAY[2]) || x/
               |> Parser.parse_and_validate_expression!(%{
                 ["x"] => {:array, :float8}
               })
               |> Runner.execute(%{["x"] => [[3, 4]]})

      assert {:error, _} =
               ~S/(ARRAY[1] || ARRAY[2]) || x/
               |> Parser.parse_and_validate_expression!(%{
                 ["x"] => {:array, :int4}
               })
               |> Runner.execute(%{["x"] => [[[3, 4]]]})
    end
  end
end
