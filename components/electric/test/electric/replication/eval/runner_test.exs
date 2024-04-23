defmodule Electric.Replication.Eval.RunnerTest do
  use ExUnit.Case, async: true

  alias Electric.Replication.Eval.Runner
  alias Electric.Replication.Eval.Parser

  describe "record_to_ref_values/3" do
    test "should build ref values from record with known types and nils" do
      refs = %{
        ["this", "string"] => :text,
        ["this", "int"] => :int4,
        ["this", "null_int"] => :int4
      }

      assert {:ok,
              %{
                ["this", "string"] => "test",
                ["this", "int"] => 5,
                ["this", "null_int"] => nil
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

    test "should correctly cast uuids" do
      assert {:ok, "b06d507c-4e08-4a7f-896a-5c3c6c5dc332"} =
               ~S|test::text|
               |> Parser.parse_and_validate_expression!(%{["test"] => :uuid})
               |> Runner.execute(%{["test"] => "b06d507c-4e08-4a7f-896a-5c3c6c5dc332"})
    end
  end
end
