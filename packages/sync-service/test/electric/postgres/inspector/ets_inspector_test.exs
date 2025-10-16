defmodule Electric.Postgres.Inspector.EtsInspectorTest do
  use ExUnit.Case, async: true
  use Repatch.ExUnit
  import Support.ComponentSetup
  import Support.DbSetup
  import Support.DbStructureSetup
  alias Electric.PersistentKV
  alias Electric.Postgres.Inspector.EtsInspector

  describe "load_relation_oid/2" do
    setup :with_shared_db
    setup :in_transaction
    setup :with_stack_id_from_test
    setup [:with_persistent_kv, :with_inspector, :with_basic_tables, :with_sql_execute]
    setup %{inspector: {EtsInspector, opts}}, do: %{opts: opts}
    setup :with_items_oid

    test "returns the relation id for a given relation", %{opts: opts} do
      assert {:ok, {oid, {"public", "items"}}} =
               EtsInspector.load_relation_oid({"public", "items"}, opts)

      assert is_integer(oid)
    end

    test "caches the relation id for a given relation once accesses", %{opts: opts} do
      assert {:ok, {oid, {"public", "items"}}} =
               EtsInspector.load_relation_oid({"public", "items"}, opts)

      assert is_integer(oid)

      Repatch.patch(Postgrex, :transaction, [mode: :shared], fn _, _ ->
        raise "should not be called again"
      end)

      Repatch.allow(self(), opts[:server])

      assert {:ok, {^oid, {"public", "items"}}} =
               EtsInspector.load_relation_oid({"public", "items"}, opts)
    end

    test "returns a not found marker when the relation does not exist", %{opts: opts} do
      assert :table_not_found = EtsInspector.load_relation_oid({"public", "nonexistent"}, opts)
    end

    test "assumes passed-in relation respects casing", %{opts: opts} do
      assert :table_not_found = EtsInspector.load_relation_oid({"public", "ITEMS"}, opts)
    end

    test "forwards the DB errors without crashing the process", %{opts: opts} do
      Repatch.patch(Postgrex, :query, [mode: :shared], fn _, _, _ ->
        {:error, %DBConnection.ConnectionError{message: "expected error"}}
      end)

      Repatch.allow(self(), opts[:server])

      assert {:error, "expected error"} =
               EtsInspector.load_relation_oid({"public", "items"}, opts)
    end
  end

  describe "load_relation_info/2" do
    setup :with_shared_db
    setup :in_transaction
    setup :with_stack_id_from_test
    setup [:with_persistent_kv, :with_inspector, :with_basic_tables, :with_sql_execute]
    setup %{inspector: {EtsInspector, opts}}, do: %{opts: opts}
    setup :with_items_oid

    test "returns relation info for a given relation", %{opts: opts, items_oid: items_oid} do
      assert {:ok,
              %{relation: {"public", "items"}, relation_id: ^items_oid, kind: :ordinary_table}} =
               EtsInspector.load_relation_info(items_oid, opts)
    end

    test "concurrent calls load value exactly once", %{
      opts: opts,
      items_oid: items_oid
    } do
      Repatch.spy(Postgrex)
      Repatch.allow(self(), opts[:server])

      task1 = Task.async(fn -> EtsInspector.load_relation_info(items_oid, opts) end)
      task2 = Task.async(fn -> EtsInspector.load_relation_info(items_oid, opts) end)

      assert {:ok,
              %{relation: {"public", "items"}, relation_id: ^items_oid, kind: :ordinary_table} =
                info} =
               Task.await(task1)

      assert {:ok, ^info} = Task.await(task2)

      # Non-parallel call should return value from cache
      assert {:ok, ^info} = EtsInspector.load_relation_info(items_oid, opts)

      assert Repatch.called?(Postgrex, :transaction, 2, by: opts[:server], exactly: 1)
    end

    test "returns a not found marker when the relation does not exist", %{opts: opts} do
      assert :table_not_found = EtsInspector.load_relation_info(1_234_567_890, opts)
    end

    test "forwards the DB errors without crashing the process", %{opts: opts} do
      Repatch.patch(Postgrex, :query, [mode: :shared], fn _, _, _ ->
        {:error, %DBConnection.ConnectionError{message: "expected error"}}
      end)

      Repatch.allow(self(), opts[:server])

      assert {:error, "expected error"} =
               EtsInspector.load_relation_info(1_234_567_890, opts)
    end

    @tag with_sql: [
           ~s|CREATE TABLE "just_normal_john" (a INT PRIMARY KEY)|
         ]
    test "returns blank children and parent for non-partitioned tables", %{
      opts: opts
    } do
      assert {:ok, {oid, _}} =
               EtsInspector.load_relation_oid({"public", "just_normal_john"}, opts)

      assert {:ok, %{relation: {"public", "just_normal_john"}, parent: nil, children: nil}} =
               EtsInspector.load_relation_info(oid, opts)
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

      assert {:ok, {oid, _}} =
               EtsInspector.load_relation_oid({"public", "partitioned_items"}, opts)

      assert {:ok,
              %{
                parent: nil,
                relation: {"public", "partitioned_items"},
                relation_id: _,
                kind: :partitioned_table,
                children: ^partitions
              }} = EtsInspector.load_relation_info(oid, opts)

      for relation <- partitions do
        assert {:ok, {oid, _}} =
                 EtsInspector.load_relation_oid(relation, opts)

        assert {:ok,
                %{
                  parent: {"public", "partitioned_items"},
                  relation: ^relation,
                  relation_id: ^oid,
                  kind: :ordinary_table,
                  children: nil
                }} = EtsInspector.load_relation_info(oid, opts)
      end
    end
  end

  describe "clean/2" do
    setup :with_shared_db
    setup :in_transaction
    setup :with_stack_id_from_test
    setup [:with_persistent_kv, :with_inspector, :with_basic_tables, :with_sql_execute]
    setup %{inspector: {EtsInspector, opts}}, do: %{opts: opts}
    setup :with_items_oid

    test "cleans up all information from ETS cache", %{
      inspector: {EtsInspector, opts},
      pg_relation_table: pg_relation_table
    } do
      assert :ets.tab2list(pg_relation_table) == []

      assert {:ok, {oid, _}} =
               EtsInspector.load_relation_oid({"public", "items"}, opts)

      refute :ets.tab2list(pg_relation_table) == []
      assert EtsInspector.clean(oid, opts)
      assert :ets.tab2list(pg_relation_table) == []
    end

    @tag with_sql: [
           ~s|CREATE TABLE "ITEMS" (a INT PRIMARY KEY)|
         ]
    test "cleans just the info for one relation", %{
      inspector: {EtsInspector, opts},
      pg_relation_table: pg_relation_table
    } do
      assert {:ok, {oid1, _}} = EtsInspector.load_relation_oid({"public", "items"}, opts)
      assert {:ok, {oid2, _}} = EtsInspector.load_relation_oid({"public", "ITEMS"}, opts)

      assert EtsInspector.clean(oid1, opts)

      assert :ets.lookup(pg_relation_table, {:relation_to_oid, {"public", "items"}}) == []
      refute :ets.lookup(pg_relation_table, {:relation_to_oid, {"public", "ITEMS"}}) == []

      assert :ets.lookup(pg_relation_table, {:oid_info, oid1}) == []
      refute :ets.lookup(pg_relation_table, {:oid_info, oid2}) == []
    end
  end

  describe "load_column_info/2" do
    setup :with_shared_db
    setup :in_transaction
    setup :with_stack_id_from_test
    setup [:with_persistent_kv, :with_inspector, :with_basic_tables, :with_sql_execute]
    setup %{inspector: {EtsInspector, opts}}, do: %{opts: opts}
    setup :with_items_oid

    test "returns column info for the table", %{opts: opts, items_oid: items_oid} do
      assert {:ok, [%{name: "id"}, %{name: "value"}]} =
               EtsInspector.load_column_info(items_oid, opts)
    end

    test "concurrent calls load value exactly once", %{
      opts: opts,
      items_oid: items_oid
    } do
      Repatch.spy(Postgrex)
      Repatch.allow(self(), opts[:server])

      task1 = Task.async(fn -> EtsInspector.load_column_info(items_oid, opts) end)
      task2 = Task.async(fn -> EtsInspector.load_column_info(items_oid, opts) end)

      assert {:ok, [%{name: "id"}, %{name: "value"}] = columns} = Task.await(task1)

      assert {:ok, ^columns} = Task.await(task2)

      # Non-parallel call should return value from cache
      assert {:ok, ^columns} = EtsInspector.load_column_info(items_oid, opts)

      assert Repatch.called?(Postgrex, :transaction, 2, by: opts[:server], exactly: 1)
    end

    test "returns a not found marker when the relation does not exist", %{opts: opts} do
      assert :table_not_found = EtsInspector.load_column_info(1_234_567_890, opts)
    end

    test "forwards the DB errors without crashing the process", %{opts: opts} do
      Repatch.patch(Postgrex, :query, [mode: :shared], fn _, _, _ ->
        {:error, %DBConnection.ConnectionError{message: "expected error"}}
      end)

      Repatch.allow(self(), opts[:server])

      assert {:error, "expected error"} =
               EtsInspector.load_column_info(1_234_567_890, opts)
    end

    @tag with_sql: [
           ~s|CREATE TABLE "partitioned_items" (a INT, b INT, c TEXT, PRIMARY KEY (a, b)) PARTITION BY RANGE (b)|
         ]
    test "can introspect partitioned tables", %{opts: opts} do
      assert {:ok, {oid, _}} =
               EtsInspector.load_relation_oid({"public", "partitioned_items"}, opts)

      assert {:ok, [%{name: "a"}, %{name: "b"}, %{name: "c"}]} =
               EtsInspector.load_column_info(oid, opts)
    end

    @tag with_sql: [
           ~s|CREATE TABLE "partitioned_items" (a INT, b INT, c TEXT, PRIMARY KEY (a, b)) PARTITION BY RANGE (b)|,
           ~s|CREATE TABLE "partitioned_items_100" PARTITION OF "partitioned_items" FOR VALUES FROM (0) TO (99)|
         ]
    test "can introspect partitions", %{opts: opts} do
      assert {:ok, {oid, _}} =
               EtsInspector.load_relation_oid({"public", "partitioned_items_100"}, opts)

      assert {:ok, [%{name: "a"}, %{name: "b"}, %{name: "c"}]} =
               EtsInspector.load_column_info(oid, opts)
    end

    @tag with_sql: [
           ~s|CREATE TYPE foo_enum AS ENUM ('a', 'b', 'c');|,
           ~s|CREATE TABLE "enum_table" (foo foo_enum)|
         ]
    test "can load enum types with type kind", %{opts: opts} do
      assert {:ok, {oid, _}} =
               EtsInspector.load_relation_oid({"public", "enum_table"}, opts)

      assert {:ok, [%{name: "foo", type_kind: :enum, type: "foo_enum"}]} =
               EtsInspector.load_column_info(oid, opts)
    end

    @tag with_sql: [
           ~s|CREATE DOMAIN foo_domain AS text CHECK ( VALUE ~ 'test');|,
           ~s|CREATE TABLE "domain_table" (foo foo_domain)|
         ]
    test "can load domain types with type kind", %{opts: opts} do
      assert {:ok, {oid, _}} =
               EtsInspector.load_relation_oid({"public", "domain_table"}, opts)

      assert {:ok, [%{name: "foo", type_kind: :domain, type: "foo_domain"}]} =
               EtsInspector.load_column_info(oid, opts)
    end
  end

  describe "load_supported_features/1" do
    setup :with_shared_db
    setup :in_transaction
    setup :with_stack_id_from_test
    setup [:with_persistent_kv, :with_inspector]
    setup %{inspector: {EtsInspector, opts}}, do: %{opts: opts}

    setup ctx do
      %{pg_version: Support.TestUtils.fetch_pg_version(ctx.db_conn)}
    end

    test "returns supported features", %{opts: opts, pg_version: pg_version} do
      assert {:ok, features} = EtsInspector.load_supported_features(opts)

      if pg_version >= 180_000 do
        assert %{supports_generated_column_replication: true} == features
      else
        assert %{supports_generated_column_replication: false} == features
      end
    end

    test "concurrent calls load value exactly once", %{opts: opts} do
      Repatch.spy(Postgrex)
      Repatch.allow(self(), opts[:server])

      task1 = Task.async(fn -> EtsInspector.load_supported_features(opts) end)
      task2 = Task.async(fn -> EtsInspector.load_supported_features(opts) end)

      assert {:ok, %{supports_generated_column_replication: _val} = features} = Task.await(task1)

      assert {:ok, ^features} = Task.await(task2)

      # Non-parallel call should return value from cache
      assert {:ok, ^features} = EtsInspector.load_supported_features(opts)

      assert Repatch.called?(Postgrex, :query, 3, by: opts[:server], exactly: 1)
    end
  end

  describe "list_relations_with_stale_cache/1" do
    setup :with_shared_db
    setup :in_transaction
    setup :with_stack_id_from_test
    setup [:with_persistent_kv, :with_inspector, :with_basic_tables, :with_sql_execute]
    setup %{inspector: {EtsInspector, opts}}, do: %{opts: opts}

    test "returns nothing when there is no cache", %{opts: opts} do
      assert {:ok, []} = EtsInspector.list_relations_with_stale_cache(opts)
    end

    test "doesn't return an unchanged relation", %{opts: opts} do
      assert {:ok, {_oid, _}} =
               EtsInspector.load_relation_oid({"public", "items"}, opts)

      assert {:ok, []} = EtsInspector.list_relations_with_stale_cache(opts)
    end

    test "returns a relation when a column is added", %{opts: opts, db_conn: conn} do
      assert {:ok, oid_relation} =
               EtsInspector.load_relation_oid({"public", "items"}, opts)

      Postgrex.query!(conn, "ALTER TABLE items ADD COLUMN new_column TEXT", [])

      assert {:ok, [^oid_relation]} = EtsInspector.list_relations_with_stale_cache(opts)
    end

    test "returns a relation when a column is dropped", %{opts: opts, db_conn: conn} do
      assert {:ok, oid_relation} =
               EtsInspector.load_relation_oid({"public", "items"}, opts)

      Postgrex.query!(conn, "ALTER TABLE items DROP COLUMN value", [])

      assert {:ok, [^oid_relation]} = EtsInspector.list_relations_with_stale_cache(opts)
    end

    test "returns a relation when a column is renamed", %{opts: opts, db_conn: conn} do
      assert {:ok, oid_relation} =
               EtsInspector.load_relation_oid({"public", "items"}, opts)

      Postgrex.query!(conn, "ALTER TABLE items RENAME COLUMN value TO renamed_column", [])

      assert {:ok, [^oid_relation]} = EtsInspector.list_relations_with_stale_cache(opts)
    end

    test "returns a relation when a column is changed", %{opts: opts, db_conn: conn} do
      assert {:ok, oid_relation} =
               EtsInspector.load_relation_oid({"public", "items"}, opts)

      Postgrex.query!(
        conn,
        "ALTER TABLE items ALTER COLUMN value TYPE INTEGER USING value::INTEGER",
        []
      )

      assert {:ok, [^oid_relation]} = EtsInspector.list_relations_with_stale_cache(opts)
    end

    test "returns a relation when table is dropped", %{opts: opts, db_conn: conn} do
      assert {:ok, oid_relation} =
               EtsInspector.load_relation_oid({"public", "items"}, opts)

      Postgrex.query!(conn, "DROP TABLE items", [])

      assert {:ok, [^oid_relation]} = EtsInspector.list_relations_with_stale_cache(opts)
    end

    test "returns a relation when table is renamed", %{opts: opts, db_conn: conn} do
      assert {:ok, oid_relation} =
               EtsInspector.load_relation_oid({"public", "items"}, opts)

      Postgrex.query!(conn, "ALTER TABLE items RENAME TO renamed_items", [])

      assert {:ok, [^oid_relation]} = EtsInspector.list_relations_with_stale_cache(opts)
    end

    test "returns a relation when table is recreated", %{opts: opts, db_conn: conn} do
      assert {:ok, oid_relation} =
               EtsInspector.load_relation_oid({"public", "items"}, opts)

      Postgrex.query!(conn, "DROP TABLE items", [])
      Postgrex.query!(conn, "CREATE TABLE items (id INT PRIMARY KEY)", [])

      assert {:ok, [^oid_relation]} = EtsInspector.list_relations_with_stale_cache(opts)
    end

    test "returns multiple relations if more than one is affected", %{opts: opts, db_conn: conn} do
      assert {:ok, oid_relation1} =
               EtsInspector.load_relation_oid({"public", "items"}, opts)

      assert {:ok, oid_relation2} =
               EtsInspector.load_relation_oid({"public", "serial_ids"}, opts)

      Postgrex.query!(conn, "ALTER TABLE items ADD COLUMN new_column TEXT", [])
      Postgrex.query!(conn, "DROP TABLE serial_ids", [])

      assert {:ok, [^oid_relation1, ^oid_relation2]} =
               EtsInspector.list_relations_with_stale_cache(opts)
    end
  end

  describe "persistance" do
    setup :with_shared_db
    setup :in_transaction
    setup :with_stack_id_from_test
    setup [:with_persistent_kv, :with_inspector, :with_basic_tables, :with_sql_execute]
    setup %{inspector: {EtsInspector, opts}}, do: %{opts: opts}

    test "loads back last seen state on a restart", %{opts: opts, db_conn: conn} = ctx do
      assert {:ok, {oid, _} = oid_relation} =
               EtsInspector.load_relation_oid({"public", "items"}, opts)

      assert {:ok, relation_info} = EtsInspector.load_relation_info(oid, opts)
      assert {:ok, columns} = EtsInspector.load_column_info(oid, opts)
      assert {:ok, features} = EtsInspector.load_supported_features(opts)
      stop_supervised!(EtsInspector)

      # Change the underlying relation to ensure we get a cached result -
      # there's another process responsible for cache invalidation on startup
      Postgrex.query!(conn, "DROP TABLE items", [])

      %{inspector: {EtsInspector, opts}} = with_inspector(ctx)

      assert {:ok, ^oid_relation} =
               EtsInspector.load_relation_oid({"public", "items"}, opts)

      assert {:ok, ^relation_info} = EtsInspector.load_relation_info(oid, opts)
      assert {:ok, ^columns} = EtsInspector.load_column_info(oid, opts)
      assert {:ok, ^features} = EtsInspector.load_supported_features(opts)
    end

    test "doesn't load back last seen state on a restart if the storage format is old",
         %{
           opts: opts,
           persistent_kv: persistent_kv,
           db_conn: conn
         } = ctx do
      assert {:ok, {oid, relation}} =
               EtsInspector.load_relation_oid({"public", "items"}, opts)

      assert {:ok, relation_info} = EtsInspector.load_relation_info(oid, opts)
      assert {:ok, columns} = EtsInspector.load_column_info(oid, opts)
      stop_supervised!(EtsInspector)
      # internal information about the persistence key, but that's for ease of testing
      persistence_key = "#{ctx.stack_id}:ets_inspector_state"

      # Prepare old data format, overwriting the existing state
      PersistentKV.set(
        persistent_kv,
        persistence_key,
        {
          # pg_info_table
          [
            {{"items", :table_to_relation}, relation_info},
            {{relation, :table_to_relation}, relation_info},
            {{relation, :columns}, columns}
          ],
          # pg_relation_table
          [
            {{relation_info, :relation_to_table}, relation},
            {{relation_info, :relation_to_table}, "items"}
          ]
        }
      )

      # Change the underlying relation to ensure we get a cached result -
      # there's another process responsible for cache invalidation on startup
      Postgrex.query!(conn, "DROP TABLE items", [])

      %{inspector: {EtsInspector, opts}} = with_inspector(ctx)
      assert :table_not_found = EtsInspector.load_relation_oid({"public", "items"}, opts)
    end
  end

  describe "with complete lack of db pool" do
    setup :with_shared_db
    setup :in_transaction
    setup :with_stack_id_from_test
    setup [:with_persistent_kv, :with_basic_tables, :with_sql_execute]

    setup ctx do
      %{inspector: {EtsInspector, opts}} = with_inspector(ctx |> Map.put(:db_conn, :no_pool))
      %{opts: opts}
    end

    test "returns error", %{opts: opts} do
      assert {:error, :connection_not_available} =
               EtsInspector.load_relation_oid({"public", "items"}, opts)

      assert {:error, :connection_not_available} =
               EtsInspector.load_column_info(1234, opts)

      assert {:error, :connection_not_available} =
               EtsInspector.load_supported_features(opts)

      assert :error = EtsInspector.list_relations_with_stale_cache(opts)
    end
  end

  describe "with pool timeout" do
    setup {Support.DbSetup, :with_unique_db}
    setup :with_stack_id_from_test
    setup [:with_persistent_kv, :with_basic_tables]

    setup %{pooled_db_config: conn_opts} = ctx do
      conn_opts =
        conn_opts
        |> Keyword.merge(pool_size: 1, queue_target: 50, queue_interval: 100)
        |> Electric.Utils.deobfuscate_password()

      busy_pool =
        start_link_supervised!(Supervisor.child_spec({Postgrex, conn_opts}, id: :busy_pool))

      %{inspector: {EtsInspector, opts}} =
        inspector_ctx =
        with_inspector(Map.merge(ctx, %{db_conn: busy_pool}))

      Map.merge(inspector_ctx, %{opts: opts, busy_pool: busy_pool})
    end

    setup %{busy_pool: busy_pool} do
      test_pid = self()

      start_link_supervised!(
        {Task,
         fn ->
           DBConnection.run(
             busy_pool,
             fn conn ->
               send(test_pid, :pool_busy)
               Postgrex.query!(conn, "SELECT PG_SLEEP(10)", [])
             end
           )
         end}
      )

      assert_receive :pool_busy
      :ok
    end

    test "returns error", %{opts: opts} do
      assert {:error, :connection_not_available} =
               EtsInspector.load_relation_oid({"public", "items"}, opts)

      assert {:error, :connection_not_available} =
               EtsInspector.load_column_info(1234, opts)

      assert :error = EtsInspector.list_relations_with_stale_cache(opts)
    end
  end

  defp with_items_oid(%{db_conn: conn}) do
    %{rows: [[oid]]} =
      Postgrex.query!(conn, "SELECT oid FROM pg_class WHERE relname = 'items'", [])

    %{items_oid: oid}
  end
end
