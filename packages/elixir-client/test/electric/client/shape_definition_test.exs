defmodule Electric.Client.ShapeDefinitionTest do
  use ExUnit.Case, async: true

  alias Electric.Client.ShapeDefinition

  doctest ShapeDefinition, import: true

  describe "table_name/1" do
    test "quotes the name if it contains characters other than [0-9a-z_-]" do
      assert ~s|my_table29| = ShapeDefinition.url_table_name(ShapeDefinition.new("my_table29"))
      assert ~s|%22my table%22| = ShapeDefinition.url_table_name(ShapeDefinition.new("my table"))
      assert ~s|%22MyTable%22| = ShapeDefinition.url_table_name(ShapeDefinition.new("MyTable"))

      assert ~s|%22My%22%22Table%22%22%22| =
               ShapeDefinition.url_table_name(ShapeDefinition.new(~s|My"Table"|))
    end

    test "adds the namespace if it exists" do
      assert ~s|my_schema.my_table| =
               ShapeDefinition.url_table_name(
                 ShapeDefinition.new("my_table", namespace: "my_schema")
               )

      assert ~s|%22my schema%22.%22my table%22| =
               ShapeDefinition.url_table_name(
                 ShapeDefinition.new("my table", namespace: "my schema")
               )
    end
  end
end
