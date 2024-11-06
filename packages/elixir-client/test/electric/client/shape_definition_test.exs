defmodule Electric.Client.ShapeDefinitionTest do
  use ExUnit.Case, async: true

  alias Electric.Client.ShapeDefinition

  doctest ShapeDefinition, import: true

  describe "new" do
    test "includes columns" do
      assert {:ok, shape} = ShapeDefinition.new("my_table", columns: ["id", "size", "cost"])
      assert shape.columns == ["id", "size", "cost"]
    end

    test "errors if column list is invalid" do
      assert {:error, _} = ShapeDefinition.new("my_table", columns: "id")
    end
  end

  describe "table_name/1" do
    test "quotes the name if it contains characters other than [0-9a-z_-]" do
      assert ~s|my_table29| = ShapeDefinition.url_table_name(ShapeDefinition.new!("my_table29"))
      assert ~s|"my table"| = ShapeDefinition.url_table_name(ShapeDefinition.new!("my table"))
      assert ~s|"MyTable"| = ShapeDefinition.url_table_name(ShapeDefinition.new!("MyTable"))

      assert ~s|"My""Table"""| =
               ShapeDefinition.url_table_name(ShapeDefinition.new!(~s|My"Table"|))
    end

    test "adds the namespace if it exists" do
      assert ~s|my_schema.my_table| =
               ShapeDefinition.url_table_name(
                 ShapeDefinition.new!("my_table", namespace: "my_schema")
               )

      assert ~s|"my schema"."my table"| =
               ShapeDefinition.url_table_name(
                 ShapeDefinition.new!("my table", namespace: "my schema")
               )
    end
  end

  describe "params/2" do
    test "format: :query returns column names joined by comma" do
      assert {:ok, shape} = ShapeDefinition.new("my_table", columns: ["id", "size", "cost"])

      assert ShapeDefinition.params(shape, format: :query) == %{
               "columns" => "id,size,cost",
               "table" => "my_table"
             }

      assert ShapeDefinition.params(shape) == %{
               "columns" => "id,size,cost",
               "table" => "my_table"
             }
    end

    test "format: :json returns column names as a list" do
      assert {:ok, shape} = ShapeDefinition.new("my_table", columns: ["id", "size", "cost"])

      assert ShapeDefinition.params(shape, format: :json) == %{
               "columns" => ["id", "size", "cost"],
               "table" => "my_table"
             }
    end
  end
end
