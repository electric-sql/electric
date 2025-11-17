defmodule Electric.Shapes.ShapeTest do
  use ExUnit.Case, async: true

  alias Electric.Shapes.Shape
  alias Electric.Shapes.Shape.Subset

  describe "new/2" do
    import Support.DbSetup
    import Support.DbStructureSetup
    import Support.ComponentSetup

    setup [
      :with_stack_id_from_test,
      :with_shared_db,
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
  end
end
