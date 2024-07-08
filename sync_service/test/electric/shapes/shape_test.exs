defmodule Electric.Shapes.ShapeTest do
  use ExUnit.Case, async: true

  alias Electric.Replication.Changes
  alias Electric.Shapes.Shape

  @opts []

  describe "from_string/2" do
    test "should parse basic shape without a schema" do
      assert {:ok, %Shape{root_table: {"public", "table"}}} = Shape.from_string("table", @opts)
    end

    test "should parse shape with a schema" do
      assert {:ok, %Shape{root_table: {"test", "table"}}} = Shape.from_string("test.table", @opts)
    end

    test "should fail to parse malformed strings" do
      assert {:error, [_]} = Shape.from_string("", @opts)
      assert {:error, [_]} = Shape.from_string(".table", @opts)
      assert {:error, [_]} = Shape.from_string("schema.", @opts)
    end
  end

  describe "change_in_shape?/2 without filters" do
    test "should include only change for the root table" do
      shape = %Shape{root_table: {"public", "table"}}
      assert Shape.change_in_shape?(shape, %Changes.NewRecord{relation: {"public", "table"}})
      refute Shape.change_in_shape?(shape, %Changes.NewRecord{relation: {"public", "table2"}})
    end
  end

  describe "new!/2" do
    test "should be equivalent to from_string/2" do
      assert %Shape{root_table: {"public", "table"}} = Shape.new!("table", @opts)
      assert %Shape{root_table: {"test", "table"}} = Shape.new!("test.table", @opts)
    end

    test "should raise on malformed strings" do
      assert_raise RuntimeError, fn ->
        Shape.new!("", @opts)
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
end
