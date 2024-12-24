defmodule Electric.Postgres.Inspector.EtsInspectorTest do
  use Support.TransactionCase, async: true
  import Support.ComponentSetup
  import Support.DbStructureSetup
  alias Electric.Postgres.Inspector.EtsInspector

  setup :with_stack_id_from_test

  describe "load_relation/2" do
    setup [
      :with_inspector,
      :with_basic_tables,
      :with_sql_execute
    ]

    setup %{inspector: {EtsInspector, opts}} do
      {:ok, %{opts: opts, table: {"public", "items"}}}
    end

    test "returns relation from table name", %{opts: opts, table: table} do
      assert {:ok, %{relation: ^table, relation_id: _, kind: :ordinary_table}} =
               EtsInspector.load_relation("PuBliC.ItEmS", opts)
    end

    test "can reload the info using the relation", %{opts: opts, table: table} do
      assert {:ok, %{relation: ^table, relation_id: _, kind: :ordinary_table}} =
               EtsInspector.load_relation("public.items", opts)

      assert {:ok, %{relation: ^table, relation_id: _, kind: :ordinary_table}} =
               EtsInspector.load_relation(table, opts)
    end

    test "returns same value from ETS cache as the original call", %{opts: opts, table: table} do
      original = EtsInspector.load_relation("PuBliC.ItEmS", opts)
      from_cache = EtsInspector.load_relation("PuBliC.ItEmS", opts)
      assert original == from_cache
      assert {:ok, %{relation: ^table, relation_id: _}} = original
    end

    test "returns same value from ETS cache as the original call with concurrent calls", %{
      opts: opts,
      table: table
    } do
      task = Task.async(fn -> EtsInspector.load_relation("PuBliC.ItEmS", opts) end)
      original = EtsInspector.load_relation("PuBliC.ItEmS", opts)
      from_cache = Task.await(task)
      assert original == from_cache
      assert {:ok, %{relation: ^table, relation_id: _}} = original
    end

    @tag with_sql: [
           ~s|CREATE TABLE "ITEMS" (a INT PRIMARY KEY)|
         ]
    test "is case insensitive when unquoted and case sensitive when quoted", %{
      opts: opts,
      table: table
    } do
      original1 = EtsInspector.load_relation("PuBliC.ITEMS", opts)
      from_cache1 = EtsInspector.load_relation("PuBliC.ITEMS", opts)
      assert original1 == from_cache1
      assert {:ok, %{relation: ^table, relation_id: _}} = original1

      original2 = EtsInspector.load_relation(~s|PuBliC."ITEMS"|, opts)
      from_cache2 = EtsInspector.load_relation(~s|PuBliC."ITEMS"|, opts)
      assert original2 == from_cache2
      assert {:ok, %{relation: {"public", "ITEMS"}, relation_id: _}} = original2
    end

    @tag with_sql: [
           ~s|CREATE TABLE "just_normal_john" (a INT PRIMARY KEY)|
         ]
    test "returns blank children and parent for non-partitioned tables", %{
      opts: opts
    } do
      assert {:ok, %{relation: {"public", "just_normal_john"}, parent: nil, children: nil}} =
               EtsInspector.load_relation("public.just_normal_john", opts)
    end

    @tag with_sql: [
           ~s|CREATE SCHEMA other|,
           ~s|CREATE TABLE "partitioned_items" (a INT, b INT, PRIMARY KEY (a, b)) PARTITION BY RANGE (b)|,
           ~s|CREATE TABLE "partitioned_items_100" PARTITION OF "partitioned_items" FOR VALUES FROM (0) TO (99)|,
           ~s|CREATE TABLE "partitioned_items_200" PARTITION OF "partitioned_items" FOR VALUES FROM (100) TO (199)|,
           ~s|CREATE TABLE other."partitioned_items_300" PARTITION OF "partitioned_items" FOR VALUES FROM (200) TO (299)|
         ]
    test "returns the partitioned table heirarchy", %{
      opts: opts
    } do
      partitions = [
        {"public", "partitioned_items_100"},
        {"public", "partitioned_items_200"},
        {"other", "partitioned_items_300"}
      ]

      assert {:ok,
              %{
                parent: nil,
                relation: {"public", "partitioned_items"},
                relation_id: _,
                kind: :partitioned_table,
                children: ^partitions
              }} = EtsInspector.load_relation("public.partitioned_items", opts)

      for {schema, name} = relation <- partitions do
        assert {:ok,
                %{
                  parent: {"public", "partitioned_items"},
                  relation: ^relation,
                  relation_id: _,
                  kind: :ordinary_table,
                  children: nil
                }} = EtsInspector.load_relation("#{schema}.#{name}", opts)
      end
    end
  end

  describe "clean/2" do
    setup [
      :with_inspector,
      :with_basic_tables,
      :with_sql_execute
    ]

    setup %{inspector: {EtsInspector, opts}} do
      %{opts: opts, table: {"public", "items"}}
    end

    @tag with_sql: [
           ~s|CREATE TABLE "ITEMS" (a INT PRIMARY KEY)|
         ]
    test "cleans up relation information from ETS cache", %{
      inspector: {EtsInspector, opts},
      pg_info_table: pg_info_table,
      pg_relation_table: pg_relation_table
    } do
      # Different spellings of the same table
      table1 = "public.items"
      table2 = "PUBLIC.ITEMS"

      # Another table
      table3 = ~s|"ITEMS"|

      assert {:ok, %{relation: rel} = relation} = EtsInspector.load_relation(table1, opts)
      assert {:ok, ^relation} = EtsInspector.load_relation(table2, opts)
      assert {:ok, relation2} = EtsInspector.load_relation(table3, opts)
      assert relation != relation2

      # Check that the relations are in the ETS cache
      assert :ets.lookup(pg_relation_table, {relation, :relation_to_table}) == [
               {{relation, :relation_to_table}, "public.items"},
               {{relation, :relation_to_table}, {"public", "items"}},
               {{relation, :relation_to_table}, "PUBLIC.ITEMS"}
             ]

      assert :ets.lookup(pg_relation_table, {relation2, :relation_to_table}) == [
               {{relation2, :relation_to_table}, ~s|"ITEMS"|},
               {{relation2, :relation_to_table}, {"public", "ITEMS"}}
             ]

      assert :ets.lookup_element(pg_info_table, {table1, :table_to_relation}, 2, :not_found) ==
               relation

      assert :ets.lookup_element(pg_info_table, {table2, :table_to_relation}, 2, :not_found) ==
               relation

      assert :ets.lookup_element(pg_info_table, {table3, :table_to_relation}, 2, :not_found) ==
               relation2

      # Now clean up the relation
      # and check that it is no longer in the ETS cache
      assert EtsInspector.clean(relation, opts)

      assert :ets.member(pg_relation_table, {relation, :relation_to_table}) == false
      assert :ets.member(pg_info_table, {table1, :table_to_relation}) == false
      assert :ets.member(pg_info_table, {table2, :table_to_relation}) == false
      # we also remove the info cached under the {schema, name} relation
      assert :ets.member(pg_info_table, {rel, :table_to_relation}) == false

      # relation2 should still be in the cache
      assert :ets.member(pg_relation_table, {relation2, :relation_to_table}) == true
      assert :ets.member(pg_info_table, {table3, :table_to_relation}) == true
    end
  end

  describe "load_column_info/2" do
    setup [:with_inspector, :with_basic_tables, :with_sql_execute]

    setup %{inspector: {EtsInspector, opts}} do
      {:ok, %{opts: opts, table: {"public", "items"}}}
    end

    test "returns column info for the table", %{opts: opts, table: table} do
      assert {:ok, [%{name: "id"}, %{name: "value"}]} = EtsInspector.load_column_info(table, opts)
    end

    test "returns same value from ETS cache as the original call", %{opts: opts, table: table} do
      original = EtsInspector.load_column_info(table, opts)
      from_cache = EtsInspector.load_column_info(table, opts)
      assert from_cache == original
    end

    test "returns same value from ETS cache as the original call with concurrent calls", %{
      opts: opts,
      table: table
    } do
      task = Task.async(fn -> EtsInspector.load_column_info(table, opts) end)
      original = EtsInspector.load_column_info(table, opts)
      from_cache = Task.await(task)
      assert from_cache == original
    end

    @tag with_sql: [
           ~s|CREATE TABLE "partitioned_items" (a INT, b INT, c TEXT, PRIMARY KEY (a, b)) PARTITION BY RANGE (b)|
         ]
    test "can introspect partitioned tables", %{opts: opts} do
      assert {:ok, [%{name: "a"}, %{name: "b"}, %{name: "c"}]} =
               EtsInspector.load_column_info({"public", "partitioned_items"}, opts)
    end

    @tag with_sql: [
           ~s|CREATE TABLE "partitioned_items" (a INT, b INT, c TEXT, PRIMARY KEY (a, b)) PARTITION BY RANGE (b)|,
           ~s|CREATE TABLE "partitioned_items_100" PARTITION OF "partitioned_items" FOR VALUES FROM (0) TO (99)|
         ]
    test "can introspect partitions", %{opts: opts} do
      assert {:ok, [%{name: "a"}, %{name: "b"}, %{name: "c"}]} =
               EtsInspector.load_column_info({"public", "partitioned_items_100"}, opts)
    end
  end
end
