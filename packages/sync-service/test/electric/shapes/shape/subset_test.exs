defmodule Electric.Shapes.Shape.SubsetTest do
  use ExUnit.Case, async: true

  alias Electric.Shapes.Shape
  alias Electric.Shapes.Shape.Subset

  describe "new/2" do
    import Support.DbSetup
    import Support.DbStructureSetup
    import Support.ComponentSetup

    setup [
      :with_stack_id_from_test,
      :with_unique_db,
      :with_persistent_kv,
      :with_inspector,
      :with_sql_execute
    ]

    setup ctx do
      %{shape_def: Shape.new!("item", inspector: ctx.inspector)}
    end

    @tag with_sql: [
           "CREATE TABLE IF NOT EXISTS project (id INT PRIMARY KEY, value INT NOT NULL)",
           "CREATE TABLE IF NOT EXISTS item (id INT PRIMARY KEY, value INT NOT NULL)"
         ]
    test "skipped parameter positions show an error", ctx do
      assert {:error, {:params, "Parameters must be numbered sequentially, starting from 1"}} =
               Subset.new(
                 ctx.shape_def,
                 [
                   where: "value < $1 AND value > $4",
                   params: %{"1" => "10", "4" => "5"}
                 ],
                 inspector: ctx.inspector
               )
    end

    @tag with_sql: [
           "CREATE TABLE IF NOT EXISTS item (id INT PRIMARY KEY, value INT NOT NULL)",
           "CREATE TYPE my_enum AS ENUM ('value1', 'value2', 'value3')",
           "CREATE TABLE IF NOT EXISTS enum_item (id INT PRIMARY KEY, my_enum my_enum NOT NULL)"
         ]
    test "where clause with enum comparison", ctx do
      shape_def = Shape.new!("enum_item", inspector: ctx.inspector)

      assert {:ok, %Subset{}} =
               Subset.new(
                 shape_def,
                 [where: "my_enum = 'value1'"],
                 inspector: ctx.inspector
               )
    end

    @tag with_sql: [
           "CREATE TABLE IF NOT EXISTS item (id INT PRIMARY KEY, value INT NOT NULL)",
           "CREATE TYPE my_enum AS ENUM ('value1', 'value2', 'value3')",
           "CREATE TABLE IF NOT EXISTS enum_item (id INT PRIMARY KEY, my_enum my_enum NOT NULL)"
         ]
    test "where clause with enum comparison casts column to text", ctx do
      shape_def = Shape.new!("enum_item", inspector: ctx.inspector)

      assert {:ok, %Subset{where: where}} =
               Subset.new(
                 shape_def,
                 [where: "my_enum = 'value1'"],
                 inspector: ctx.inspector
               )

      # The query should cast the enum column to text to avoid
      # "operator does not exist: enum = text" errors
      assert where.query =~ "my_enum::text"
    end

    @tag with_sql: [
           "CREATE TABLE IF NOT EXISTS item (id INT PRIMARY KEY, value INT NOT NULL)",
           "CREATE TYPE my_enum AS ENUM ('value1', 'value2', 'value3')",
           "CREATE TABLE IF NOT EXISTS enum_item (id INT PRIMARY KEY, my_enum my_enum NOT NULL)"
         ]
    test "where clause with enum comparison and parameter casts column to text", ctx do
      shape_def = Shape.new!("enum_item", inspector: ctx.inspector)

      assert {:ok, %Subset{where: where}} =
               Subset.new(
                 shape_def,
                 [where: "my_enum = $1", params: %{"1" => "value1"}],
                 inspector: ctx.inspector
               )

      # The query should cast the enum column to text to avoid
      # "operator does not exist: enum = text" errors
      assert where.query =~ "my_enum::text"
      # The parameter should also be cast to text
      assert where.query =~ "'value1'::text"
    end
  end
end
