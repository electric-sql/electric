defmodule Electric.Shapes.ShapeTest do
  use ExUnit.Case, async: true

  alias Electric.Replication.Changes.{NewRecord, DeletedRecord, UpdatedRecord}
  alias Electric.Replication.Eval.Parser
  alias Electric.Replication.Changes
  alias Electric.Shapes.Shape

  @where Parser.parse_and_validate_expression!("value ILIKE '%matches%'", %{["value"] => :text})
  @where_array Parser.parse_and_validate_expression!("data && '{1,2}'", %{
                 ["data"] => {:array, :int4}
               })
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

    test "lets INSERTs through only if the row matches the where filter with arrays" do
      shape = %Shape{
        root_table: {"public", "table"},
        root_table_id: @relation_id,
        where: @where_array
      }

      matching_insert = %NewRecord{
        relation: {"public", "table"},
        record: %{"id" => 1, "data" => "{{1}}"}
      }

      non_matching_insert = %NewRecord{
        relation: {"public", "table"},
        record: %{"id" => 2, "data" => "{{3},{4}}"}
      }

      assert Shape.convert_change(shape, matching_insert) == [matching_insert]
      assert Shape.convert_change(shape, non_matching_insert) == []
    end

    test "lets DELETEs through only if the row matches the where filter" do
      shape = %Shape{root_table: {"public", "table"}, root_table_id: @relation_id, where: @where}

      matching_delete = %DeletedRecord{
        relation: {"public", "table"},
        old_record: %{"id" => 1, "value" => "matches filter"}
      }

      non_matching_delete = %DeletedRecord{
        relation: {"public", "table"},
        old_record: %{"id" => 2, "value" => "doesn't match filter"}
      }

      assert Shape.convert_change(shape, matching_delete) == [matching_delete]
      assert Shape.convert_change(shape, non_matching_delete) == []
    end

    test "lets UPDATEs through as-is only if both old and new versions match the where filter" do
      shape = %Shape{root_table: {"public", "table"}, root_table_id: @relation_id, where: @where}

      matching_update = %UpdatedRecord{
        relation: {"public", "table"},
        old_record: %{"id" => 1, "value" => "old matches"},
        record: %{"id" => 1, "value" => "new matches"}
      }

      assert Shape.convert_change(shape, matching_update) == [matching_update]
    end

    test "converts UPDATE to INSERT if only new version matches the where filter" do
      shape = %Shape{root_table: {"public", "table"}, root_table_id: @relation_id, where: @where}

      update_to_insert = %UpdatedRecord{
        relation: {"public", "table"},
        old_record: %{"id" => 1, "value" => "old doesn't match"},
        record: %{"id" => 1, "value" => "new matches"}
      }

      expected_insert = Changes.convert_update(update_to_insert, to: :new_record)
      assert Shape.convert_change(shape, update_to_insert) == [expected_insert]
    end

    test "converts UPDATE to DELETE if only old version matches the where filter" do
      shape = %Shape{root_table: {"public", "table"}, root_table_id: @relation_id, where: @where}

      update_to_delete = %UpdatedRecord{
        relation: {"public", "table"},
        old_record: %{"id" => 1, "value" => "old matches"},
        record: %{"id" => 1, "value" => "new doesn't match"}
      }

      expected_delete = Changes.convert_update(update_to_delete, to: :deleted_record)
      assert Shape.convert_change(shape, update_to_delete) == [expected_delete]
    end

    test "doesn't let the update through if no version of the row matches the where filter" do
      shape = %Shape{root_table: {"public", "table"}, root_table_id: @relation_id, where: @where}

      non_matching_update = %UpdatedRecord{
        relation: {"public", "table"},
        old_record: %{"id" => 1, "value" => "old doesn't match"},
        record: %{"id" => 1, "value" => "new doesn't match either"}
      }

      assert Shape.convert_change(shape, non_matching_update) == []
    end

    test "filters INSERTs to allow only selected columns" do
      shape = %Shape{
        root_table: {"public", "table"},
        root_table_id: @relation_id,
        selected_columns: ["id", "value"]
      }

      insert = %NewRecord{
        relation: {"public", "table"},
        record: %{"id" => 1, "value" => "foo", "other_value" => "bar"}
      }

      assert Shape.convert_change(shape, insert) == [
               %NewRecord{
                 relation: {"public", "table"},
                 record: %{"id" => 1, "value" => "foo"}
               }
             ]
    end

    test "filters DELETEs to allow only selected columns" do
      shape = %Shape{
        root_table: {"public", "table"},
        root_table_id: @relation_id,
        selected_columns: ["id", "value"]
      }

      delete = %DeletedRecord{
        relation: {"public", "table"},
        old_record: %{"id" => 1, "value" => "foo", "other_value" => "bar"}
      }

      assert Shape.convert_change(shape, delete) == [
               %DeletedRecord{
                 relation: {"public", "table"},
                 old_record: %{"id" => 1, "value" => "foo"}
               }
             ]
    end

    test "doesn't let the update through if filtered columns have not changed" do
      shape = %Shape{
        root_table: {"public", "table"},
        root_table_id: @relation_id,
        selected_columns: ["id", "value"]
      }

      non_matching_update = %UpdatedRecord{
        relation: {"public", "table"},
        old_record: %{"id" => 1, "value" => "same", "other_value" => "old"},
        record: %{"id" => 1, "value" => "same", "other_value" => "new"}
      }

      assert Shape.convert_change(shape, non_matching_update) == []
    end

    test "re-writes changes to partition on shape" do
      shape = %Shape{
        root_table: {"public", "partition_root"},
        root_table_id: @relation_id,
        partitions: %{
          {"public", "partition_01"} => {"public", "partition_root"},
          {"public", "partition_02"} => {"public", "partition_root"}
        }
      }

      partition_update = %UpdatedRecord{
        relation: {"public", "partition_02"},
        old_record: %{"id" => 1, "value" => "same", "other_value" => "old"},
        record: %{"id" => 1, "value" => "same", "other_value" => "new"}
      }

      assert Shape.convert_change(shape, partition_update) == [
               %UpdatedRecord{
                 relation: {"public", "partition_root"},
                 old_record: %{"id" => 1, "value" => "same", "other_value" => "old"},
                 record: %{"id" => 1, "value" => "same", "other_value" => "new"}
               }
             ]
    end
  end

  describe "new/2" do
    import Support.DbSetup
    import Support.DbStructureSetup
    import Support.ComponentSetup

    setup [
      :with_stack_id_from_test,
      :with_shared_db,
      :with_inspector,
      :with_sql_execute
    ]

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
      {:error, {:table, ["Invalid zero-length delimited identifier"]}} =
        Shape.new("", inspector: inspector)
    end

    test "errors when the table doesn't exist", %{inspector: inspector} do
      {:error,
       {
         :table,
         [
           ~S|Table "nonexistent" does not exist. If the table name contains capitals or special characters you must quote it.|
         ]
       }} =
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
      assert {:error, {:where, "At location 6" <> _}} =
               Shape.new("other_table", inspector: inspector, where: "value + 1 > 10")
    end

    @tag with_sql: [
           "CREATE TABLE IF NOT EXISTS arr_table (value TEXT PRIMARY KEY, data int[] NOT NULL)"
         ]
    test "validates a where clause based on array columns", %{inspector: inspector} do
      assert {:ok, %Shape{where: %{query: "data @> '{1,2}'"}}} =
               Shape.new("arr_table", inspector: inspector, where: "data @> '{1,2}'")
    end

    @tag with_sql: [
           "CREATE TABLE IF NOT EXISTS col_table (id INT PRIMARY KEY, value1 TEXT, value2 TEXT)"
         ]
    test "builds a shape with selected columns", %{inspector: inspector} do
      assert {:ok, %Shape{selected_columns: ["id", "value2"]}} =
               Shape.new("col_table", inspector: inspector, columns: ["id", "value2"])
    end

    @tag with_sql: [
           "CREATE TABLE IF NOT EXISTS col_table (id INT PRIMARY KEY, value1 TEXT, value2 TEXT)"
         ]
    test "validates selected columns for invalid columns", %{inspector: inspector} do
      assert {:error, {:columns, ["The following columns could not be found: invalid"]}} =
               Shape.new("col_table", inspector: inspector, columns: ["id", "invalid"])
    end

    @tag with_sql: [
           "CREATE TABLE IF NOT EXISTS col_table (id INT PRIMARY KEY, value1 TEXT, value2 TEXT)"
         ]
    test "validates selected columns for missing PK columns", %{inspector: inspector} do
      assert {:error, {:columns, ["Must include all primary key columns, missing: id"]}} =
               Shape.new("col_table", inspector: inspector, columns: ["value1"])
    end

    @tag with_sql: [
           "CREATE TABLE IF NOT EXISTS other_table (value TEXT PRIMARY KEY)"
         ]
    test "assigns the correct replica value", %{inspector: inspector} do
      assert {:ok, %Shape{replica: :default}} =
               Shape.new("other_table", inspector: inspector, replica: :default)

      assert {:ok, %Shape{replica: :full}} =
               Shape.new("other_table", inspector: inspector, replica: :full)

      assert {:error, _} = Shape.new("other_table", inspector: inspector, replica: :teapot)
    end
  end

  describe "new!/2" do
    import Support.DbSetup
    import Support.DbStructureSetup
    import Support.ComponentSetup

    setup [
      :with_stack_id_from_test,
      :with_shared_db,
      :with_inspector,
      :with_sql_execute
    ]

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

    test "different values of `send_delta` produce differing ids" do
      refute Shape.hash(%Shape{
               root_table: {"public", "table2"},
               root_table_id: 1001,
               where: "something = true",
               replica: :default
             }) ==
               Shape.hash(%Shape{
                 root_table: {"public", "table2"},
                 root_table_id: 1001,
                 where: "something = true",
                 replica: :full
               })
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
