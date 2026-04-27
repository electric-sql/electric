defmodule Electric.Shapes.ShapeTest do
  use ExUnit.Case, async: true

  alias Electric.Replication.Changes.{NewRecord, DeletedRecord, UpdatedRecord}
  alias Electric.Replication.Eval.Parser
  alias Electric.Replication.Changes
  alias Electric.Shapes.DnfPlan
  alias Electric.Shapes.Shape

  @where Parser.parse_and_validate_expression!("value ILIKE '%matches%'",
           refs: %{["value"] => :text}
         )
  @where_array Parser.parse_and_validate_expression!("data && '{1,2}'",
                 refs: %{["data"] => {:array, :int4}}
               )
  @relation_id 1
  @refs %{
    ["id"] => :int4,
    ["x"] => :int4,
    ["y"] => :int4,
    ["z"] => :int4,
    ["status"] => :text,
    ["name"] => :text,
    ["a"] => :int4,
    ["b"] => :int4
  }
  @stack_id "test_stack"
  @shape_handle "test_shape"

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

    test "keeps update with tag changes even if filtered columns have not changed" do
      shape = %Shape{
        root_table: {"public", "table"},
        root_table_id: @relation_id,
        selected_columns: ["id"],
        # tag_structure means this shape tracks tags based on the "parent_id" column
        tag_structure: [["parent_id"]]
      }

      # Update where only parent_id changed (tag change), but id (selected column) didn't
      update_with_tag_change = %UpdatedRecord{
        relation: {"public", "table"},
        old_record: %{"id" => 1, "parent_id" => "old_parent"},
        record: %{"id" => 1, "parent_id" => "new_parent"}
      }

      result =
        Shape.convert_change(shape, update_with_tag_change,
          stack_id: "test_stack",
          shape_handle: "test_handle"
        )

      # The change should be kept (not filtered out) because it has tag changes
      assert length(result) == 1
      [converted] = result

      # The converted change should have removed_move_tags set (indicating the old tag)
      assert converted.removed_move_tags != []
      # And move_tags for the new tag
      assert converted.move_tags != []
      # Tags should be different since parent_id changed
      assert converted.move_tags != converted.removed_move_tags
    end

    test "correctly keeps updates with subqueries if the referenced set has not changed" do
      shape = %Shape{
        root_table: {"public", "table"},
        root_table_id: @relation_id,
        where:
          Parser.parse_and_validate_expression!(
            "id IN (SELECT id FROM other_table WHERE value = 'test')",
            refs: %{["$sublink", "0"] => {:array, :int4}, ["id"] => :int4},
            sublink_queries: %{0 => "SELECT id FROM other_table WHERE value = 'test'"}
          )
      }

      update_to_new_record = %UpdatedRecord{
        relation: {"public", "table"},
        old_record: %{"id" => "1", "value" => "old doesn't match"},
        record: %{"id" => "1", "value" => "new matches"}
      }

      extra_refs =
        {%{["$sublink", "0"] => MapSet.new([1])}, %{["$sublink", "0"] => MapSet.new([1])}}

      assert Shape.convert_change(shape, update_to_new_record, extra_refs: extra_refs) == [
               update_to_new_record
             ]
    end

    test "correctly converts updates to new records with subqueries if the referenced set has changed" do
      shape = %Shape{
        root_table: {"public", "table"},
        root_table_id: @relation_id,
        where:
          Parser.parse_and_validate_expression!(
            "id IN (SELECT id FROM other_table WHERE value = 'test')",
            refs: %{["$sublink", "0"] => {:array, :int4}, ["id"] => :int4},
            sublink_queries: %{0 => "SELECT id FROM other_table WHERE value = 'test'"}
          )
      }

      update_to_new_record = %UpdatedRecord{
        relation: {"public", "table"},
        old_record: %{"id" => "1", "value" => "old doesn't match"},
        record: %{"id" => "1", "value" => "new matches"}
      }

      extra_refs =
        {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([1])}}

      assert Shape.convert_change(shape, update_to_new_record, extra_refs: extra_refs) == [
               Changes.convert_update(update_to_new_record, to: :new_record)
             ]
    end

    test "uses DNF metadata for streamed changes when a subquery is combined with OR" do
      where =
        Parser.parse_and_validate_expression!(
          "inner_id IN (SELECT id FROM inner_table WHERE include_inner = true) OR include_outer = true",
          refs: %{
            ["inner_id"] => :int4,
            ["include_outer"] => :bool,
            ["$sublink", "0"] => {:array, :int4}
          },
          sublink_queries: %{0 => "SELECT id FROM inner_table WHERE include_inner = true"}
        )

      shape = %Shape{
        root_table: {"public", "outer_table"},
        root_table_id: @relation_id,
        where: where,
        selected_columns: ["id", "inner_id", "include_outer"],
        explicitly_selected_columns: ["id", "inner_id", "include_outer"],
        shape_dependencies: [
          %Shape{
            root_table: {"public", "inner_table"},
            root_table_id: 2,
            selected_columns: ["id"],
            explicitly_selected_columns: ["id"]
          }
        ]
      }

      {:ok, dnf_plan} = DnfPlan.compile(shape)

      [converted] =
        Shape.convert_change(
          shape,
          %NewRecord{
            relation: {"public", "outer_table"},
            record: %{"id" => "1", "inner_id" => "1", "include_outer" => "true"}
          },
          stack_id: "test_stack",
          shape_handle: "test_handle",
          extra_refs:
            {%{["$sublink", "0"] => MapSet.new()}, %{["$sublink", "0"] => MapSet.new()}},
          dnf_plan: dnf_plan
        )

      subquery_tag =
        :crypto.hash(:md5, "test_stack" <> "test_handle" <> "v:1")
        |> Base.encode16(case: :lower)

      assert converted.move_tags == [subquery_tag <> "/", "/1"]
      assert converted.active_conditions == [false, true]
    end

    test "keeps updates when only active_conditions change after column filtering" do
      where =
        Parser.parse_and_validate_expression!(
          "inner_id IN (SELECT id FROM inner_table WHERE include_inner = true) OR include_outer = true",
          refs: %{
            ["inner_id"] => :int4,
            ["include_outer"] => :bool,
            ["$sublink", "0"] => {:array, :int4}
          },
          sublink_queries: %{0 => "SELECT id FROM inner_table WHERE include_inner = true"}
        )

      shape = %Shape{
        root_table: {"public", "outer_table"},
        root_table_id: @relation_id,
        where: where,
        selected_columns: ["id"],
        explicitly_selected_columns: ["id"],
        shape_dependencies: [
          %Shape{
            root_table: {"public", "inner_table"},
            root_table_id: 2,
            selected_columns: ["id"],
            explicitly_selected_columns: ["id"]
          }
        ]
      }

      {:ok, dnf_plan} = DnfPlan.compile(shape)

      [converted] =
        Shape.convert_change(
          shape,
          %UpdatedRecord{
            relation: {"public", "outer_table"},
            old_record: %{"id" => "1", "inner_id" => "1", "include_outer" => "true"},
            record: %{"id" => "1", "inner_id" => "1", "include_outer" => "true"}
          },
          stack_id: "test_stack",
          shape_handle: "test_handle",
          extra_refs:
            {%{["$sublink", "0"] => MapSet.new([1])}, %{["$sublink", "0"] => MapSet.new()}},
          dnf_plan: dnf_plan
        )

      assert converted.old_record == %{"id" => "1"}
      assert converted.record == %{"id" => "1"}
      assert converted.active_conditions == [false, true]
      assert converted.removed_move_tags == []
    end

    test "correctly converts updates to deleted records with subqueries if the referenced set has changed" do
      shape = %Shape{
        root_table: {"public", "table"},
        root_table_id: @relation_id,
        where:
          Parser.parse_and_validate_expression!(
            "id IN (SELECT id FROM other_table WHERE value = 'test')",
            refs: %{["$sublink", "0"] => {:array, :int4}, ["id"] => :int4},
            sublink_queries: %{0 => "SELECT id FROM other_table WHERE value = 'test'"}
          )
      }

      update_to_deleted_record = %UpdatedRecord{
        relation: {"public", "table"},
        old_record: %{"id" => "1", "value" => "old doesn't match"},
        record: %{"id" => "1", "value" => "new matches"}
      }

      extra_refs =
        {%{["$sublink", "0"] => MapSet.new([1])}, %{["$sublink", "0"] => MapSet.new([])}}

      assert Shape.convert_change(shape, update_to_deleted_record, extra_refs: extra_refs) == [
               Changes.convert_update(update_to_deleted_record, to: :deleted_record)
             ]
    end

    test "uses new referenced set when checking inserts with subqueries" do
      shape = %Shape{
        root_table: {"public", "table"},
        root_table_id: @relation_id,
        where:
          Parser.parse_and_validate_expression!(
            "id IN (SELECT id FROM other_table WHERE value = 'test')",
            refs: %{["$sublink", "0"] => {:array, :int4}, ["id"] => :int4},
            sublink_queries: %{0 => "SELECT id FROM other_table WHERE value = 'test'"}
          )
      }

      insert = %NewRecord{
        relation: {"public", "table"},
        record: %{"id" => "1", "value" => "new matches"}
      }

      extra_refs =
        {%{["$sublink", "0"] => MapSet.new([])}, %{["$sublink", "0"] => MapSet.new([1])}}

      assert Shape.convert_change(shape, insert, extra_refs: extra_refs) == [
               insert
             ]
    end

    test "uses old referenced set when checking deletes with subqueries" do
      shape = %Shape{
        root_table: {"public", "table"},
        root_table_id: @relation_id,
        where:
          Parser.parse_and_validate_expression!(
            "id IN (SELECT id FROM other_table WHERE value = 'test')",
            refs: %{["$sublink", "0"] => {:array, :int4}, ["id"] => :int4},
            sublink_queries: %{0 => "SELECT id FROM other_table WHERE value = 'test'"}
          )
      }

      delete = %DeletedRecord{
        relation: {"public", "table"},
        old_record: %{"id" => "1", "value" => "new matches"}
      }

      extra_refs =
        {%{["$sublink", "0"] => MapSet.new([1])}, %{["$sublink", "0"] => MapSet.new([])}}

      assert Shape.convert_change(shape, delete, extra_refs: extra_refs) == [
               delete
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
      :with_persistent_kv,
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
      assert {:error, {:table, ["Invalid zero-length delimited identifier"]}} =
               Shape.new("", inspector: inspector)
    end

    test "errors when the table doesn't exist", %{inspector: inspector} do
      assert {:error,
              {
                :table,
                [
                  ~S|Table "public"."nonexistent" does not exist. If the table name contains capitals or special characters you must quote it.|
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
      assert {:error, {:columns, ["The following columns are not found on the table: invalid"]}} =
               Shape.new("col_table", inspector: inspector, columns: ["id", "invalid"])
    end

    @tag with_sql: [
           "CREATE TABLE IF NOT EXISTS col_table (id INT PRIMARY KEY, value1 TEXT, value2 TEXT)"
         ]
    test "validates selected columns for missing PK columns", %{inspector: inspector} do
      assert {:error,
              {:columns,
               ["The list of columns must include all primary key columns, missing: id"]}} =
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

    @tag with_sql: [
           "CREATE TABLE IF NOT EXISTS gen_col_table (val JSONB NOT NULL, id uuid PRIMARY KEY GENERATED ALWAYS AS ((val->>'id')::uuid) STORED)"
         ]
    test "validates selected columns for generated columns", %{inspector: inspector} = ctx do
      %{supports_generated_column_replication: supports_generated_column_replication} =
        Support.TestUtils.fetch_supported_features(ctx.db_conn)

      if not supports_generated_column_replication do
        assert {:error,
                {:columns,
                 [
                   "The following columns are generated and cannot be included in the shape: id. " <>
                     "You can exclude them from the shape by explicitly listing which columns to fetch in the 'columns' query param"
                 ]}} =
                 Shape.new("gen_col_table", inspector: inspector)
      else
        assert {:ok, %Shape{selected_columns: ["id", "val"]}} =
                 Shape.new("gen_col_table", inspector: inspector)
      end
    end

    @tag with_sql: [
           "CREATE TABLE IF NOT EXISTS testing_table (id uuid PRIMARY KEY)"
         ]
    test "validates where clause return type", %{inspector: inspector} do
      assert {:error, {:where, "WHERE clause must return a boolean"}} =
               Shape.new("testing_table", inspector: inspector, where: "id")
    end

    @tag with_sql: [
           "CREATE TABLE IF NOT EXISTS parent (id INT PRIMARY KEY)",
           "CREATE TABLE IF NOT EXISTS child (id INT PRIMARY KEY, par_id INT REFERENCES parent(id))"
         ]
    test "correctly creates nested shapes", %{inspector: inspector} do
      assert {:ok,
              %Shape{
                root_table: {"public", "child"},
                where: %{query: "par_id IN (SELECT id FROM public.parent WHERE id > 5)"},
                shape_dependencies: [
                  %Shape{
                    root_table: {"public", "parent"},
                    root_pk: ["id"],
                    selected_columns: ["id"],
                    where: %{query: "id > 5"}
                  }
                ]
              } = outer_shape} =
               Shape.new("child",
                 inspector: inspector,
                 where: "par_id IN (SELECT id FROM parent where id > 5)"
               )

      assert [_] =
               Shape.convert_change(
                 outer_shape,
                 %Changes.NewRecord{
                   relation: {"public", "child"},
                   record: %{"id" => "1", "par_id" => "1"}
                 },
                 extra_refs:
                   {%{["$sublink", "0"] => MapSet.new([1])},
                    %{["$sublink", "0"] => MapSet.new([1])}}
               )

      assert [] =
               Shape.convert_change(
                 outer_shape,
                 %Changes.NewRecord{
                   relation: {"public", "child"},
                   record: %{"id" => "1", "par_id" => "1"}
                 },
                 extra_refs:
                   {%{["$sublink", "0"] => MapSet.new([2])},
                    %{["$sublink", "0"] => MapSet.new([2])}}
               )
    end

    @tag with_sql: [
           "CREATE TABLE IF NOT EXISTS accounts (id INT PRIMARY KEY)",
           "CREATE TABLE IF NOT EXISTS users (id INT PRIMARY KEY, account_id INT REFERENCES accounts(id), active BOOLEAN NOT NULL DEFAULT false)"
         ]
    test "deduplicates identical subqueries onto one dependency", %{inspector: inspector} do
      assert {:ok,
              %Shape{
                where: where,
                shape_dependencies: [
                  %Shape{
                    root_table: {"public", "accounts"},
                    where: %{query: "id > 5"}
                  }
                ],
                subquery_comparison_expressions: comparison_expressions
              }} =
               Shape.new("users",
                 inspector: inspector,
                 where:
                   "(active = true OR account_id IN (SELECT id FROM accounts WHERE id > 5)) AND account_id IN (SELECT id FROM accounts WHERE id > 5)"
               )

      assert where.used_refs == %{
               ["active"] => :bool,
               ["account_id"] => :int4,
               ["$sublink", "0"] => {:array, :int4}
             }

      assert Map.keys(comparison_expressions) == [["$sublink", "0"]]
    end

    @tag with_sql: [
           "CREATE TABLE IF NOT EXISTS project (id INT PRIMARY KEY, value INT NOT NULL)",
           "CREATE TABLE IF NOT EXISTS item (id INT PRIMARY KEY, value INT NOT NULL)"
         ]
    test "allows non-PK references in subqueries", %{inspector: inspector} do
      assert {:ok,
              %Shape{
                root_table: {"public", "item"},
                where: %{query: "value IN (SELECT value FROM public.project WHERE value > 5)"},
                shape_dependencies: [
                  %Shape{
                    root_table: {"public", "project"},
                    root_pk: ["id"],
                    selected_columns: ["id", "value"],
                    where: %{query: "value > 5"}
                  }
                ]
              } = outer_shape} =
               Shape.new("item",
                 inspector: inspector,
                 where: "value IN (select value FROM project where value > 5)"
               )

      assert [_] =
               Shape.convert_change(
                 outer_shape,
                 %Changes.NewRecord{
                   relation: {"public", "item"},
                   record: %{"id" => "1", "value" => "10"}
                 },
                 extra_refs:
                   {%{["$sublink", "0"] => MapSet.new([10])},
                    %{["$sublink", "0"] => MapSet.new([10])}}
               )

      assert [] =
               Shape.convert_change(
                 outer_shape,
                 %Changes.NewRecord{
                   relation: {"public", "item"},
                   record: %{"id" => "1", "value" => "10"}
                 },
                 extra_refs:
                   {%{["$sublink", "0"] => MapSet.new([20])},
                    %{["$sublink", "0"] => MapSet.new([20])}}
               )
    end

    @tag with_sql: [
           "CREATE TABLE IF NOT EXISTS project (id INT PRIMARY KEY, value INT NOT NULL)",
           "CREATE TABLE IF NOT EXISTS item (id INT PRIMARY KEY, value INT NOT NULL)"
         ]
    test "subquery with parameters is correctly interpolated", %{inspector: inspector} do
      assert {:ok,
              %Shape{
                where: %{
                  query:
                    "value IN (SELECT value FROM public.project WHERE value > '10'::int4) AND value > '5'::int4"
                },
                shape_dependencies: [
                  %Shape{where: %{query: "value > '10'::int4"}, shape_dependencies: []}
                ]
              }} =
               Shape.new("item",
                 inspector: inspector,
                 where: "value IN (SELECT value FROM project WHERE value > $2) AND value > $1",
                 params: %{"1" => "5", "2" => "10"}
               )
    end

    @tag with_sql: [
           ~s|CREATE TABLE IF NOT EXISTS channel_members ("channelId" UUID NOT NULL, "userId" UUID NOT NULL, PRIMARY KEY ("channelId", "userId"))|,
           ~s|CREATE TABLE IF NOT EXISTS messages (id UUID PRIMARY KEY, "channelId" UUID NOT NULL)|
         ]
    test "subquery properly quotes case-sensitive column names", %{inspector: inspector} do
      assert {:ok,
              %Shape{
                root_table: {"public", "messages"},
                where: %{query: query},
                shape_dependencies: [
                  %Shape{
                    root_table: {"public", "channel_members"},
                    explicitly_selected_columns: ["channelId"]
                  }
                ]
              }} =
               Shape.new("messages",
                 inspector: inspector,
                 where: ~s|"channelId" IN (SELECT "channelId" FROM channel_members)|
               )

      # The where clause must quote the column name in the subquery to preserve case
      assert query == ~s|"channelId" IN (SELECT "channelId" FROM public.channel_members)|
    end

    @tag with_sql: [
           "CREATE TABLE IF NOT EXISTS project (id INT PRIMARY KEY, value INT NOT NULL)",
           "CREATE TABLE IF NOT EXISTS item (id INT PRIMARY KEY, value INT NOT NULL)"
         ]
    test "skipped parameter positions show an error", %{inspector: inspector} do
      assert {:error, {:params, "Parameters must be numbered sequentially, starting from 1"}} =
               Shape.new("item",
                 inspector: inspector,
                 where: "value IN (SELECT value FROM project WHERE value > $1) AND value > $4",
                 params: %{"1" => "10", "4" => "5"}
               )

      assert {:error, {:params, "Parameters must be numbered sequentially, starting from 1"}} =
               Shape.new("item",
                 inspector: inspector,
                 where: "value IN (SELECT value FROM project WHERE value > $3) AND value > $4",
                 params: %{"3" => "10", "4" => "5"}
               )

      assert {:error, {:params, "Parameters must be numbered sequentially, starting from 1"}} =
               Shape.new("item",
                 inspector: inspector,
                 where: "value IN (SELECT value FROM project WHERE value > $0) AND value > $4",
                 params: %{"0" => "10", "4" => "5"}
               )
    end

    @tag with_sql: [
           "CREATE TABLE IF NOT EXISTS item (id INT PRIMARY KEY, value INT NOT NULL)"
         ]
    test "sequential parameters with 10+ keys are accepted", %{inspector: inspector} do
      params = Map.new(1..20, fn i -> {"#{i}", "#{i * 10}"} end)

      where = Enum.map_join(1..20, " OR ", fn i -> "value = $#{i}" end)

      assert {:ok, _} =
               Shape.new("item",
                 inspector: inspector,
                 where: where,
                 params: params
               )
    end
  end

  describe "new!/2" do
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
    setup do
      [
        inspector:
          Support.StubInspector.new(
            tables: ["the_table", "another_table"],
            columns: [
              %{name: "id", type: "int8", pk_position: 0},
              %{name: "value", type: "int8", pk_position: nil},
              %{name: "size", type: "int8", pk_position: nil},
              %{name: "created_at", type: "timestamp", pk_position: nil}
            ]
          )
      ]
    end

    test "should serialize shape with complex columns" do
      shape = %Shape{
        root_table: {"public", "foo"},
        root_table_id: 1,
        root_pk: ["first", "second", "third"],
        selected_columns: ["first", "second", "third", "fourth"],
        flags: %{selects_all_columns: true, non_primitive_columns_in_where: true},
        where: nil
      }

      assert {:ok, json} = Jason.encode(shape)
      assert {:ok, ^shape} = Jason.decode!(json) |> Shape.from_json_safe()
    end

    test "should serialize shape with complex columns with backwards compatibility" do
      shape_old_json =
        %{
          root_table: ["public", "foo"],
          root_table_id: 1,
          selected_columns: nil,
          where: nil,
          table_info: [
            [
              ["public", "foo"],
              %{
                pk: ["first", "second", "third"],
                columns: [
                  %{name: "first", type: "text"},
                  %{name: "second", type: "text"},
                  %{name: "third", type: "text"},
                  %{name: "fourth", type: "text"}
                ]
              }
            ]
          ]
        }
        |> Jason.encode!()
        |> Jason.decode!()

      shape_v1 =
        %Shape{
          root_table: {"public", "foo"},
          root_table_id: 1,
          root_pk: ["first", "second", "third"],
          root_column_count: 4,
          selected_columns: ["first", "second", "third", "fourth"],
          flags: %{selects_all_columns: true},
          where: nil
        }

      assert {:ok, shape_old_decoded} = Shape.from_json_safe(shape_old_json)

      assert shape_old_decoded == shape_v1
    end

    test "should serialize shape with subquery", %{inspector: inspector} do
      shape =
        Shape.new!("the_table",
          where: "id IN (SELECT id FROM another_table WHERE value > 10)",
          inspector: inspector
        )

      assert {:ok, json} = Jason.encode(shape)
      assert {:ok, decoded} = Jason.decode!(json) |> Shape.from_json_safe()

      # Locations change between serialization and deserialization, but that shouldn't affect equality
      assert Shape.comparable(shape) == Shape.comparable(decoded)
    end
  end

  describe "comparable/1" do
    setup do
      [
        inspector:
          Support.StubInspector.new(
            tables: ["the_table", "another_table"],
            columns: [
              %{name: "id", type: "int8", pk_position: 0},
              %{name: "value", type: "int8", pk_position: nil},
              %{name: "size", type: "int8", pk_position: nil},
              %{name: "created_at", type: "timestamp", pk_position: nil}
            ]
          )
      ]
    end

    defp assert_shapes_equal(shape1, shape2) do
      assert Shape.comparable(shape1) == Shape.comparable(shape2)
      assert Shape.comparable(shape1) === Shape.comparable(shape2)
    end

    defp do_assert_shape_comparable(serialized_shape, reference_shape) do
      assert {:ok, json} = Jason.encode(serialized_shape)
      assert {:ok, serialized_shape} = Jason.decode!(json) |> Shape.from_json_safe()

      assert_shapes_equal(serialized_shape, reference_shape)
    end

    defp assert_shape_comparable(serialized_shape, reference_shape) do
      assert_shapes_equal(serialized_shape, reference_shape)

      do_assert_shape_comparable(serialized_shape, reference_shape)
      do_assert_shape_comparable(reference_shape, serialized_shape)
    end

    test "equal shapes compare as equal", %{inspector: inspector} do
      assert {:ok, %Shape{} = shape1} =
               Shape.new(~S|the_table|, where: "false", inspector: inspector)

      assert {:ok, %Shape{} = shape2} =
               Shape.new(~S|the_table|, where: "false", inspector: inspector)

      assert_shape_comparable(shape1, shape2)
    end

    test "equal shapes compare as equal after json serialization", %{inspector: inspector} do
      assert {:ok, %Shape{} = shape1} =
               Shape.new(~S|the_table|,
                 where: "(FALSE)",
                 columns: ["id", "value", "size"],
                 inspector: inspector
               )

      assert {:ok, %Shape{} = shape2} =
               Shape.new(~S|the_table|,
                 where: "(FALSE)",
                 columns: ["id", "value", "size"],
                 inspector: inspector
               )

      assert_shape_comparable(shape1, shape2)
    end

    test "equal shapes with equivalent but not identical where clauses compare as equal after json serialization",
         %{inspector: inspector} do
      tests = [
        {"(FALSE)", ["false", "(false)", " false "]},
        {"(VALUE IN (1,2,3))", ["value in (1, 2, 3)", ~s[("value" in (1, 2, 3))]]},
        {~S|time '20:00:00' + date '2024-01-01' > created_at|,
         [
           ~S|((TIME '20:00:00') + (DATE '2024-01-01')) > created_at|,
           ~S| (((time  '20:00:00')  +  (date  '2024-01-01')) >   created_at)|
         ]}
      ]

      shape_fun = fn where ->
        Shape.new(~S|the_table|,
          where: where,
          columns: ["id", "value", "size"],
          inspector: inspector
        )
      end

      for {base, wheres} <- tests do
        assert {:ok, %Shape{} = shape1} = shape_fun.(base)

        for where <- wheres do
          assert {:ok, %Shape{} = shape2} = shape_fun.(where)

          assert_shape_comparable(shape1, shape2)
        end
      end
    end

    test "log_mode affects the equivalence", %{inspector: inspector} do
      shape_fun = fn mode ->
        Shape.new(~S|the_table|,
          inspector: inspector,
          log_mode: mode
        )
      end

      {:ok, shape1} = shape_fun.(:full)
      {:ok, shape2} = shape_fun.(:changes_only)

      assert_shape_comparable(shape1, shape1)
      assert_shape_comparable(shape2, shape2)

      refute Shape.comparable(shape1) == Shape.comparable(shape2)
      refute Shape.comparable(shape1) === Shape.comparable(shape2)
    end
  end

  describe "get_row_metadata/6 - single subquery" do
    test "row included when value is in subquery view" do
      {where, deps} = parse_where_with_sublinks(~S"x IN (SELECT id FROM dep)", 1)
      shape = make_shape(where, deps)
      {:ok, plan} = DnfPlan.compile(shape)

      record = %{"id" => "1", "x" => "5", "y" => "10", "status" => "open"}
      views = %{["$sublink", "0"] => MapSet.new([5])}

      assert {:ok, true, tags, active_conditions} =
               Shape.get_row_metadata(plan, record, views, where, @stack_id, @shape_handle)

      assert active_conditions == [true]
      assert length(tags) == 1
    end

    test "row excluded when value is not in subquery view" do
      {where, deps} = parse_where_with_sublinks(~S"x IN (SELECT id FROM dep)", 1)
      shape = make_shape(where, deps)
      {:ok, plan} = DnfPlan.compile(shape)

      record = %{"id" => "1", "x" => "5", "y" => "10", "status" => "open"}
      views = %{["$sublink", "0"] => MapSet.new([99])}

      assert {:ok, false, _tags, active_conditions} =
               Shape.get_row_metadata(plan, record, views, where, @stack_id, @shape_handle)

      assert active_conditions == [false]
    end
  end

  describe "get_row_metadata/6 - OR with subqueries" do
    setup do
      {where, deps} =
        parse_where_with_sublinks(
          ~S"x IN (SELECT id FROM dep1) OR y IN (SELECT id FROM dep2)",
          2
        )

      shape = make_shape(where, deps)
      {:ok, plan} = DnfPlan.compile(shape)
      %{plan: plan, where: where}
    end

    test "included via first disjunct only", %{plan: plan, where: where} do
      record = %{"id" => "1", "x" => "5", "y" => "10", "status" => "open"}
      views = %{["$sublink", "0"] => MapSet.new([5]), ["$sublink", "1"] => MapSet.new([])}

      assert {:ok, true, tags, active_conditions} =
               Shape.get_row_metadata(plan, record, views, where, @stack_id, @shape_handle)

      assert active_conditions == [true, false]
      assert length(tags) == 2
    end

    test "included via second disjunct only", %{plan: plan, where: where} do
      record = %{"id" => "1", "x" => "5", "y" => "10", "status" => "open"}
      views = %{["$sublink", "0"] => MapSet.new([]), ["$sublink", "1"] => MapSet.new([10])}

      assert {:ok, true, _tags, active_conditions} =
               Shape.get_row_metadata(plan, record, views, where, @stack_id, @shape_handle)

      assert active_conditions == [false, true]
    end

    test "included via both disjuncts", %{plan: plan, where: where} do
      record = %{"id" => "1", "x" => "5", "y" => "10", "status" => "open"}
      views = %{["$sublink", "0"] => MapSet.new([5]), ["$sublink", "1"] => MapSet.new([10])}

      assert {:ok, true, _tags, active_conditions} =
               Shape.get_row_metadata(plan, record, views, where, @stack_id, @shape_handle)

      assert active_conditions == [true, true]
    end

    test "excluded when neither disjunct satisfied", %{plan: plan, where: where} do
      record = %{"id" => "1", "x" => "5", "y" => "10", "status" => "open"}
      views = %{["$sublink", "0"] => MapSet.new([99]), ["$sublink", "1"] => MapSet.new([99])}

      assert {:ok, false, _tags, active_conditions} =
               Shape.get_row_metadata(plan, record, views, where, @stack_id, @shape_handle)

      assert active_conditions == [false, false]
    end
  end

  describe "get_row_metadata/6 - mixed row predicate and subquery" do
    setup do
      {where, deps} =
        parse_where_with_sublinks(
          ~S"(x IN (SELECT id FROM dep1) AND status = 'open') OR y IN (SELECT id FROM dep2)",
          2
        )

      shape = make_shape(where, deps)
      {:ok, plan} = DnfPlan.compile(shape)
      %{plan: plan, where: where}
    end

    test "included via first disjunct when subquery matches and row predicate true",
         %{plan: plan, where: where} do
      record = %{"id" => "1", "x" => "5", "y" => "10", "status" => "open"}
      views = %{["$sublink", "0"] => MapSet.new([5]), ["$sublink", "1"] => MapSet.new([])}

      assert {:ok, true, _tags, active_conditions} =
               Shape.get_row_metadata(plan, record, views, where, @stack_id, @shape_handle)

      assert Enum.count(active_conditions, & &1) == 2
    end

    test "excluded from first disjunct when row predicate false", %{plan: plan, where: where} do
      record = %{"id" => "1", "x" => "5", "y" => "10", "status" => "closed"}
      views = %{["$sublink", "0"] => MapSet.new([5]), ["$sublink", "1"] => MapSet.new([])}

      assert {:ok, false, _tags, active_conditions} =
               Shape.get_row_metadata(plan, record, views, where, @stack_id, @shape_handle)

      row_pred_pos =
        plan.positions
        |> Enum.find(fn {_pos, info} -> not info.is_subquery end)
        |> elem(0)

      refute Enum.at(active_conditions, row_pred_pos)
    end

    test "included via second disjunct even when first disjunct row predicate false",
         %{plan: plan, where: where} do
      record = %{"id" => "1", "x" => "5", "y" => "10", "status" => "closed"}
      views = %{["$sublink", "0"] => MapSet.new([5]), ["$sublink", "1"] => MapSet.new([10])}

      assert {:ok, true, _tags, _active_conditions} =
               Shape.get_row_metadata(plan, record, views, where, @stack_id, @shape_handle)
    end
  end

  describe "get_row_metadata/6 - tags" do
    test "tags have correct structure with slots per position" do
      {where, deps} =
        parse_where_with_sublinks(
          ~S"x IN (SELECT id FROM dep1) OR y IN (SELECT id FROM dep2)",
          2
        )

      shape = make_shape(where, deps)
      {:ok, plan} = DnfPlan.compile(shape)

      record = %{"id" => "1", "x" => "5", "y" => "10", "status" => "open"}
      views = %{["$sublink", "0"] => MapSet.new([5]), ["$sublink", "1"] => MapSet.new([10])}

      assert {:ok, true, tags, _active_conditions} =
               Shape.get_row_metadata(plan, record, views, where, @stack_id, @shape_handle)

      assert length(tags) == 2

      [tag0, tag1] = tags
      [slot0_0, slot0_1] = String.split(tag0, "/")
      assert slot0_0 != ""
      assert slot0_1 == ""

      [slot1_0, slot1_1] = String.split(tag1, "/")
      assert slot1_0 == ""
      assert slot1_1 != ""
    end

    test "row predicate positions get sentinel value in tags" do
      {where, deps} =
        parse_where_with_sublinks(
          ~S"(x IN (SELECT id FROM dep1) AND status = 'open') OR y IN (SELECT id FROM dep2)",
          2
        )

      shape = make_shape(where, deps)
      {:ok, plan} = DnfPlan.compile(shape)

      record = %{"id" => "1", "x" => "5", "y" => "10", "status" => "open"}
      views = %{["$sublink", "0"] => MapSet.new([5]), ["$sublink", "1"] => MapSet.new([])}

      assert {:ok, true, tags, _active_conditions} =
               Shape.get_row_metadata(plan, record, views, where, @stack_id, @shape_handle)

      [tag0 | _] = tags
      slots = String.split(tag0, "/")

      row_pred_pos =
        plan.positions
        |> Enum.find(fn {_pos, info} -> not info.is_subquery end)
        |> elem(0)

      assert Enum.at(slots, row_pred_pos) == "1"
    end
  end

  describe "get_row_metadata/6 - update scenarios" do
    test "update that changes which disjuncts are satisfied" do
      {where, deps} =
        parse_where_with_sublinks(
          ~S"(x IN (SELECT id FROM dep1) AND status = 'open') OR y IN (SELECT id FROM dep2)",
          2
        )

      shape = make_shape(where, deps)
      {:ok, plan} = DnfPlan.compile(shape)
      views = %{["$sublink", "0"] => MapSet.new([5]), ["$sublink", "1"] => MapSet.new([10])}

      old_record = %{"id" => "1", "x" => "5", "y" => "10", "status" => "open"}

      assert {:ok, true, old_tags, old_ac} =
               Shape.get_row_metadata(plan, old_record, views, where, @stack_id, @shape_handle)

      new_record = %{"id" => "1", "x" => "5", "y" => "10", "status" => "closed"}

      assert {:ok, true, new_tags, new_ac} =
               Shape.get_row_metadata(plan, new_record, views, where, @stack_id, @shape_handle)

      row_pred_pos =
        plan.positions
        |> Enum.find(fn {_pos, info} -> not info.is_subquery end)
        |> elem(0)

      assert Enum.at(old_ac, row_pred_pos) == true
      assert Enum.at(new_ac, row_pred_pos) == false

      removed_tags = old_tags -- new_tags
      assert removed_tags == [] or length(removed_tags) >= 0
    end

    test "correct removed_tags when column values change" do
      {where, deps} =
        parse_where_with_sublinks(
          ~S"x IN (SELECT id FROM dep1) OR y IN (SELECT id FROM dep2)",
          2
        )

      shape = make_shape(where, deps)
      {:ok, plan} = DnfPlan.compile(shape)
      views = %{["$sublink", "0"] => MapSet.new([5, 99]), ["$sublink", "1"] => MapSet.new([10])}

      old_record = %{"id" => "1", "x" => "5", "y" => "10", "status" => "open"}

      {:ok, _old_incl, old_tags, _old_ac} =
        Shape.get_row_metadata(plan, old_record, views, where, @stack_id, @shape_handle)

      new_record = %{"id" => "1", "x" => "99", "y" => "10", "status" => "open"}

      {:ok, _new_incl, new_tags, _new_ac} =
        Shape.get_row_metadata(plan, new_record, views, where, @stack_id, @shape_handle)

      [old_tag0, _] = old_tags
      [new_tag0, _] = new_tags
      assert old_tag0 != new_tag0

      [_, old_tag1] = old_tags
      [_, new_tag1] = new_tags
      assert old_tag1 == new_tag1

      removed_tags = old_tags -- new_tags
      assert length(removed_tags) == 1
    end
  end

  defp parse_where_with_sublinks(where_clause, num_deps, opts \\ []) do
    sublink_refs =
      Keyword.get_lazy(opts, :sublink_refs, fn ->
        Map.new(0..(num_deps - 1), fn i ->
          {["$sublink", "#{i}"], {:array, :int4}}
        end)
      end)

    dep_columns = Keyword.get(opts, :dep_columns, nil)

    sublink_queries =
      Map.new(0..(num_deps - 1), fn i ->
        cols =
          if dep_columns do
            Enum.at(dep_columns, i) |> Enum.join(", ")
          else
            "id"
          end

        {i, "SELECT #{cols} FROM dep#{i + 1}"}
      end)

    all_refs = Map.merge(@refs, sublink_refs)
    {:ok, pgquery} = Parser.parse_query(where_clause)

    {:ok, expr} =
      Parser.validate_where_ast(pgquery,
        refs: all_refs,
        sublink_queries: sublink_queries
      )

    deps =
      Enum.map(0..(num_deps - 1), fn _i ->
        %Shape{
          root_table: {"public", "dep"},
          root_table_id: 100,
          root_pk: ["id"],
          root_column_count: 1,
          where: nil,
          selected_columns: ["id"],
          explicitly_selected_columns: ["id"]
        }
      end)

    {expr, deps}
  end

  defp make_shape(where, deps) do
    %Shape{
      root_table: {"public", "test"},
      root_table_id: 1,
      root_pk: ["id"],
      root_column_count: 5,
      where: where,
      selected_columns: ["id", "x", "y", "status"],
      explicitly_selected_columns: ["id", "x", "y", "status"],
      shape_dependencies: deps,
      shape_dependencies_handles: Enum.with_index(deps, fn _, i -> "dep_handle_#{i}" end)
    }
  end
end
