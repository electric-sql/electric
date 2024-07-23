defmodule Electric.Shapes.ShapeTest do
  use ExUnit.Case, async: true

  alias Electric.Replication.Changes.NewRecord
  alias Electric.Replication.Eval.Parser
  alias Electric.Replication.Changes
  alias Electric.Shapes.Shape

  @opts [inspector: {__MODULE__, nil}]

  @where Parser.parse_and_validate_expression!("value ILIKE '%matches%'", %{["value"] => :text})

  describe "convert_change/2" do
    test "skips changes for other tables" do
      assert Shape.convert_change(%Shape{root_table: {"public", "table"}}, %NewRecord{
               relation: {"public", "other_table"},
               record: %{"value" => "my value"}
             }) == []

      assert Shape.convert_change(
               %Shape{root_table: {"public", "table"}, where: @where},
               %NewRecord{
                 relation: {"public", "other_table"},
                 record: %{"value" => "my value"}
               }
             ) == []
    end

    test "always lets changes through for current table if no where clause is specified" do
      change = %NewRecord{
        relation: {"public", "table"},
        record: %{"value" => "my value"}
      }

      assert Shape.convert_change(%Shape{root_table: {"public", "table"}}, change) == [change]
    end

    test "lets INSERTs through only if the row matches the where filter" do
      shape = %Shape{root_table: {"public", "table"}, where: @where}

      matching_insert = %NewRecord{
        relation: {"public", "table"},
        record: %{"id" => 1, "value" => "matches filter"}
      }

      non_matching_insert = %NewRecord{
        relation: {"public", "table"},
        record: %{"id" => 2, "value" => "doesn't match filter"}
      }

      assert Shape.convert_change(shape, matching_insert) == [matching_insert]
      assert Shape.convert_change(shape, non_matching_insert) == []
    end

    test "lets DELETEs through only if the row matches the where filter" do
      shape = %Shape{root_table: {"public", "table"}, where: @where}

      matching_delete = %Changes.DeletedRecord{
        relation: {"public", "table"},
        old_record: %{"id" => 1, "value" => "matches filter"}
      }

      non_matching_delete = %Changes.DeletedRecord{
        relation: {"public", "table"},
        old_record: %{"id" => 2, "value" => "doesn't match filter"}
      }

      assert Shape.convert_change(shape, matching_delete) == [matching_delete]
      assert Shape.convert_change(shape, non_matching_delete) == []
    end

    test "lets UPDATEs through as-is only if both old and new versions match the where filter" do
      shape = %Shape{root_table: {"public", "table"}, where: @where}

      matching_update = %Changes.UpdatedRecord{
        relation: {"public", "table"},
        old_record: %{"id" => 1, "value" => "old matches"},
        record: %{"id" => 1, "value" => "new matches"}
      }

      assert Shape.convert_change(shape, matching_update) == [matching_update]
    end

    test "converts UPDATE to INSERT if only new version matches the where filter" do
      shape = %Shape{root_table: {"public", "table"}, where: @where}

      update_to_insert = %Changes.UpdatedRecord{
        relation: {"public", "table"},
        old_record: %{"id" => 1, "value" => "old doesn't match"},
        record: %{"id" => 1, "value" => "new matches"}
      }

      expected_insert = Changes.convert_update(update_to_insert, to: :new_record)
      assert Shape.convert_change(shape, update_to_insert) == [expected_insert]
    end

    test "converts UPDATE to DELETE if only old version matches the where filter" do
      shape = %Shape{root_table: {"public", "table"}, where: @where}

      update_to_delete = %Changes.UpdatedRecord{
        relation: {"public", "table"},
        old_record: %{"id" => 1, "value" => "old matches"},
        record: %{"id" => 1, "value" => "new doesn't match"}
      }

      expected_delete = Changes.convert_update(update_to_delete, to: :deleted_record)
      assert Shape.convert_change(shape, update_to_delete) == [expected_delete]
    end

    test "doesn't let the update through if no version of the row matches the where filter" do
      shape = %Shape{root_table: {"public", "table"}, where: @where}

      non_matching_update = %Changes.UpdatedRecord{
        relation: {"public", "table"},
        old_record: %{"id" => 1, "value" => "old doesn't match"},
        record: %{"id" => 1, "value" => "new doesn't match either"}
      }

      assert Shape.convert_change(shape, non_matching_update) == []
    end
  end

  describe "new/2" do
    test "builds up a table correctly" do
      assert {:ok, %Shape{root_table: {"public", "table"}}} = Shape.new("table", @opts)
      assert {:ok, %Shape{root_table: {"test", "table"}}} = Shape.new("test.table", @opts)
    end

    test "errors on malformed strings" do
      {:error, ["table name does not match expected format"]} = Shape.new("", @opts)
    end

    test "errors when the table doesn't exist" do
      {:error, ["table not found"]} = Shape.new("nonexistent", @opts)
    end

    test "builds a shape with a where clause" do
      assert {:ok, %Shape{where: %{query: "value = 'test'"}}} =
               Shape.new("other_table", @opts ++ [where: "value = 'test'"])
    end

    test "validates a where clause based on inspected columns" do
      assert {:error, "At location 6" <> _} =
               Shape.new("other_table", @opts ++ [where: "value + 1 > 10"])
    end
  end

  describe "new!/2" do
    test "should build up a table correctly" do
      assert %Shape{root_table: {"public", "table"}} = Shape.new!("table", @opts)
      assert %Shape{root_table: {"test", "table"}} = Shape.new!("test.table", @opts)
    end

    test "should raise on malformed strings" do
      assert_raise RuntimeError, fn ->
        Shape.new!("", @opts)
      end
    end

    test "raises on malformed where clause" do
      assert_raise RuntimeError, fn ->
        Shape.new!("other_table", @opts ++ [where: "value + 1 > 10"])
      end
    end
  end

  describe "hash/1" do
    test "should not have same integer value for differnt shape" do
      assert is_integer(Shape.hash(%Shape{root_table: {"public", "table"}}))

      assert Shape.hash(%Shape{root_table: {"public", "table"}}) !=
               Shape.hash(%Shape{root_table: {"public", "table2"}})
    end
  end

  def load_column_info({"public", "table"}, _),
    do: {:ok, [%{name: "id", type: "int8", pk_position: 0}]}

  def load_column_info({"test", "table"}, _),
    do: {:ok, [%{name: "id", type: "int8", pk_position: 0}]}

  def load_column_info({"public", "other_table"}, _),
    do:
      {:ok,
       [
         %{name: "id", type: "int8", pk_position: 0},
         %{name: "value", type: "text", pk_position: nil}
       ]}

  def load_column_info(_, _), do: :table_not_found
end
