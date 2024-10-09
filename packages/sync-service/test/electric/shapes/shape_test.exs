defmodule Electric.Shapes.ShapeTest do
  use ExUnit.Case, async: true

  alias Electric.Replication.Changes.NewRecord
  alias Electric.Replication.Eval.Parser
  alias Electric.Replication.Changes
  alias Electric.Shapes.Shape

  @where Parser.parse_and_validate_expression!("value ILIKE '%matches%'", %{["value"] => :text})
  @relation_id 1

  describe "convert_change/2" do
    test "skips changes for other tables" do
      assert Shape.convert_change(
               %Shape{root_table: {"public", "table"}, root_table_id: 2},
               %NewRecord{
                 relation: {"public", "other_table"},
                 record: %{"value" => "my value"}
               }
             ) == []

      assert Shape.convert_change(
               %Shape{
                 root_table: {"public", "table"},
                 root_table_id: @relation_id,
                 where: @where
               },
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

      assert Shape.convert_change(
               %Shape{root_table: {"public", "table"}, root_table_id: 2},
               change
             ) == [change]
    end

    test "lets INSERTs through only if the row matches the where filter" do
      shape = %Shape{root_table: {"public", "table"}, root_table_id: @relation_id, where: @where}

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
      shape = %Shape{root_table: {"public", "table"}, root_table_id: @relation_id, where: @where}

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
      shape = %Shape{root_table: {"public", "table"}, root_table_id: @relation_id, where: @where}

      matching_update = %Changes.UpdatedRecord{
        relation: {"public", "table"},
        old_record: %{"id" => 1, "value" => "old matches"},
        record: %{"id" => 1, "value" => "new matches"}
      }

      assert Shape.convert_change(shape, matching_update) == [matching_update]
    end

    test "converts UPDATE to INSERT if only new version matches the where filter" do
      shape = %Shape{root_table: {"public", "table"}, root_table_id: @relation_id, where: @where}

      update_to_insert = %Changes.UpdatedRecord{
        relation: {"public", "table"},
        old_record: %{"id" => 1, "value" => "old doesn't match"},
        record: %{"id" => 1, "value" => "new matches"}
      }

      expected_insert = Changes.convert_update(update_to_insert, to: :new_record)
      assert Shape.convert_change(shape, update_to_insert) == [expected_insert]
    end

    test "converts UPDATE to DELETE if only old version matches the where filter" do
      shape = %Shape{root_table: {"public", "table"}, root_table_id: @relation_id, where: @where}

      update_to_delete = %Changes.UpdatedRecord{
        relation: {"public", "table"},
        old_record: %{"id" => 1, "value" => "old matches"},
        record: %{"id" => 1, "value" => "new doesn't match"}
      }

      expected_delete = Changes.convert_update(update_to_delete, to: :deleted_record)
      assert Shape.convert_change(shape, update_to_delete) == [expected_delete]
    end

    test "doesn't let the update through if no version of the row matches the where filter" do
      shape = %Shape{root_table: {"public", "table"}, root_table_id: @relation_id, where: @where}

      non_matching_update = %Changes.UpdatedRecord{
        relation: {"public", "table"},
        old_record: %{"id" => 1, "value" => "old doesn't match"},
        record: %{"id" => 1, "value" => "new doesn't match either"}
      }

      assert Shape.convert_change(shape, non_matching_update) == []
    end
  end

  describe "new/2" do
    import Support.DbSetup
    import Support.DbStructureSetup
    import Support.ComponentSetup

    setup [:with_shared_db, :with_inspector, :with_sql_execute]

    @tag with_sql: [
           "CREATE SCHEMA IF NOT EXISTS test",
           "CREATE SCHEMA IF NOT EXISTS θtestθ",
           "CREATE SCHEMA IF NOT EXISTS foo",
           ~S|CREATE SCHEMA IF NOT EXISTS "foo.bar"|,
           "CREATE TABLE IF NOT EXISTS public.tbl (a INT PRIMARY KEY)",
           "CREATE TABLE IF NOT EXISTS public._table123 (a INT PRIMARY KEY)",
           "CREATE TABLE IF NOT EXISTS public.table$ (a INT PRIMARY KEY)",
           "CREATE TABLE IF NOT EXISTS public.θtable (a INT PRIMARY KEY)",
           "CREATE TABLE IF NOT EXISTS public.Δtbl (a INT PRIMARY KEY)",
           ~S|CREATE TABLE IF NOT EXISTS public."Tbl" (a INT PRIMARY KEY)|,
           ~S|CREATE TABLE IF NOT EXISTS public."!table "".a" (a INT PRIMARY KEY)|,
           ~S|CREATE TABLE IF NOT EXISTS θtestθ.θtableθ (a INT PRIMARY KEY)|,
           ~S|CREATE TABLE IF NOT EXISTS test.tbl (a INT PRIMARY KEY)|,
           ~S|CREATE TABLE IF NOT EXISTS public."foo.bar.baz" (a INT PRIMARY KEY)|,
           ~S|CREATE TABLE IF NOT EXISTS "foo"."bar.baz" (a INT PRIMARY KEY)|,
           ~S|CREATE TABLE IF NOT EXISTS "foo.bar"."baz" (a INT PRIMARY KEY)|
         ]
    test "builds up a table correctly", %{inspector: inspector} do
      assert {:ok, %Shape{root_table: {"public", "tbl"}}} =
               Shape.new(~S|tbl|, inspector: inspector)

      assert {:ok, %Shape{root_table: {"public", "_table123"}}} =
               Shape.new(~S|_table123|, inspector: inspector)

      assert {:ok, %Shape{root_table: {"public", "table$"}}} =
               Shape.new(~S|table$|, inspector: inspector)

      assert {:ok, %Shape{root_table: {"public", "θtable"}}} =
               Shape.new(~S|θtable|, inspector: inspector)

      assert {:ok, %Shape{root_table: {"public", "Δtbl"}}} =
               Shape.new(~S|Δtbl|, inspector: inspector)

      assert {:ok, %Shape{root_table: {"public", "tbl"}}} =
               Shape.new(~S|Tbl|, inspector: inspector)

      assert {:ok, %Shape{root_table: {"public", "Tbl"}}} =
               Shape.new(~S|"Tbl"|, inspector: inspector)

      assert {:ok, %Shape{root_table: {"public", ~S|!table ".a|}}} =
               Shape.new(~S|"!table "".a"|, inspector: inspector)

      assert {:ok, %Shape{root_table: {"θtestθ", "θtableθ"}}} =
               Shape.new(~S|θtestθ.θtableθ|, inspector: inspector)

      assert {:ok, %Shape{root_table: {"test", "tbl"}}} =
               Shape.new(~S|test.tbl|, inspector: inspector)

      assert {:ok, %Shape{root_table: {"test", "tbl"}}} =
               Shape.new(~S|"test".tbl|, inspector: inspector)

      assert {:ok, %Shape{root_table: {"test", "tbl"}}} =
               Shape.new(~S|test."tbl"|, inspector: inspector)

      assert {:ok, %Shape{root_table: {"test", "tbl"}}} =
               Shape.new(~S|"test"."tbl"|, inspector: inspector)

      assert {:ok, %Shape{root_table: {"public", "foo.bar.baz"}}} =
               Shape.new(~S|"foo.bar.baz"|, inspector: inspector)

      assert {:ok, %Shape{root_table: {"foo", "bar.baz"}}} =
               Shape.new(~S|"foo"."bar.baz"|, inspector: inspector)

      assert {:ok, %Shape{root_table: {"foo.bar", "baz"}}} =
               Shape.new(~S|"foo.bar"."baz"|, inspector: inspector)
    end

    test "errors on empty table name", %{inspector: inspector} do
      {:error, ["ERROR 42602 (invalid_name) invalid name syntax"]} =
        Shape.new("", inspector: inspector)
    end

    test "errors when the table doesn't exist", %{inspector: inspector} do
      {:error,
       [
         ~S|Table "nonexistent" does not exist. If the table name contains capitals or special characters you must quote it.|
       ]} =
        Shape.new("nonexistent", inspector: inspector)
    end

    @tag with_sql: [
           "CREATE TABLE IF NOT EXISTS other_table (value TEXT PRIMARY KEY)"
         ]
    test "builds a shape with a where clause", %{inspector: inspector} do
      assert {:ok, %Shape{where: %{query: "value = 'test'"}}} =
               Shape.new("other_table", inspector: inspector, where: "value = 'test'")
    end

    @tag with_sql: [
           "CREATE TABLE IF NOT EXISTS other_table (value TEXT PRIMARY KEY)"
         ]
    test "validates a where clause based on inspected columns", %{inspector: inspector} do
      assert {:error, "At location 6" <> _} =
               Shape.new("other_table", inspector: inspector, where: "value + 1 > 10")
    end
  end

  describe "new!/2" do
    import Support.DbSetup
    import Support.DbStructureSetup
    import Support.ComponentSetup

    setup [:with_shared_db, :with_inspector, :with_sql_execute]

    @tag with_sql: [
           "CREATE SCHEMA IF NOT EXISTS test",
           "CREATE TABLE IF NOT EXISTS tbl (a INT PRIMARY KEY)",
           "CREATE TABLE IF NOT EXISTS test.tbl (a INT PRIMARY KEY)"
         ]
    test "should build up a table correctly", %{inspector: inspector} do
      assert %Shape{root_table: {"public", "tbl"}} = Shape.new!("tbl", inspector: inspector)
      assert %Shape{root_table: {"test", "tbl"}} = Shape.new!("test.tbl", inspector: inspector)
    end

    test "should raise on malformed strings", %{inspector: inspector} do
      assert_raise RuntimeError, fn ->
        Shape.new!("", inspector: inspector)
      end
    end

    @tag with_sql: [
           "CREATE TABLE IF NOT EXISTS other_table (value TEXT PRIMARY KEY)"
         ]
    test "raises on malformed where clause", %{inspector: inspector} do
      assert_raise RuntimeError, fn ->
        Shape.new!("other_table", inspector: inspector, where: "value + 1 > 10")
      end
    end
  end

  describe "hash/1" do
    test "should not have same integer value for different shape" do
      assert is_integer(Shape.hash(%Shape{root_table: {"public", "table"}, root_table_id: 2}))

      assert Shape.hash(%Shape{root_table: {"public", "table"}, root_table_id: 1}) !=
               Shape.hash(%Shape{root_table: {"public", "table2"}, root_table_id: 2})
    end

    test "should not have same integer value for different shape, same table different OID" do
      assert Shape.hash(%Shape{root_table: {"public", "table"}, root_table_id: 1}) !=
               Shape.hash(%Shape{root_table: {"public", "table"}, root_table_id: 2})
    end
  end

  describe "JSON" do
    test "should serialize shape with complex columns" do
      shape = %Electric.Shapes.Shape{
        root_table: {"public", "foo"},
        root_table_id: 1,
        table_info: %{
          {"public", "foo"} => %{
            columns: [
              %{
                name: "second",
                type: :text,
                formatted_type: "text",
                type_mod: -1,
                pk_position: 1,
                type_id: {25, -1},
                array_dimensions: 0,
                not_null: true,
                array_type: nil
              },
              %{
                name: "first",
                type: :text,
                formatted_type: "text",
                type_mod: -1,
                pk_position: 0,
                type_id: {25, -1},
                array_dimensions: 0,
                not_null: true,
                array_type: nil
              },
              %{
                name: "fourth",
                type: :text,
                formatted_type: "text",
                type_mod: -1,
                pk_position: nil,
                type_id: {25, -1},
                array_dimensions: 0,
                not_null: false,
                array_type: nil
              },
              %{
                name: "third",
                type: :text,
                formatted_type: "text",
                type_mod: -1,
                pk_position: 2,
                type_id: {25, -1},
                array_dimensions: 0,
                not_null: true,
                array_type: nil
              }
            ],
            pk: ["first", "second", "third"]
          }
        },
        where: nil
      }

      assert {:ok, json} = Jason.encode(shape)
      assert ^shape = Jason.decode!(json) |> Shape.from_json_safe!()
    end
  end

  def load_column_info({"public", "table"}, _),
    do: {:ok, [%{name: "id", type: "int8", pk_position: 0}]}

  def load_column_info({"public", "Table"}, _),
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

  def load_column_info({"public", "_table123"}, _),
    do: {:ok, [%{name: "id", type: "int8", pk_position: 0}]}

  def load_column_info({"public", ~S|!table ".a|}, _),
    do: {:ok, [%{name: "id", type: "int8", pk_position: 0}]}

  def load_column_info({"public", "foo.bar.baz"}, _),
    do: {:ok, [%{name: "id", type: "int8", pk_position: 0}]}

  def load_column_info({"foo", "bar.baz"}, _),
    do: {:ok, [%{name: "id", type: "int8", pk_position: 0}]}

  def load_column_info({"foo.bar", "baz"}, _),
    do: {:ok, [%{name: "id", type: "int8", pk_position: 0}]}

  def load_column_info({"public", "table$"}, _),
    do: {:ok, [%{name: "id", type: "int8", pk_position: 0}]}

  def load_column_info({"public", "Δtbl"}, _),
    do: {:ok, [%{name: "id", type: "int8", pk_position: 0}]}

  def load_column_info({"public", "θtable"}, _),
    do: {:ok, [%{name: "id", type: "int8", pk_position: 0}]}

  def load_column_info({"θtestθ", "θtableθ"}, _),
    do: {:ok, [%{name: "id", type: "int8", pk_position: 0}]}

  def load_column_info(_, _), do: :table_not_found

  def load_relation(tbl, _),
    do: Support.StubInspector.load_relation(tbl, nil)
end
