defmodule Electric.Postgres.Extension.SchemaCacheTest do
  defmodule MockProducer do
    use GenStage

    def start_link(conn_config) do
      GenStage.start_link(__MODULE__, conn_config)
    end

    def produce(pid, msgs) do
      GenStage.call(pid, {:produce, msgs})
    end

    def init(_config) do
      {:producer, %{}}
    end

    def handle_demand(_demand, state) do
      {:noreply, [], state}
    end

    def handle_call({:produce, msgs}, _from, state) do
      {:reply, :ok, msgs, state}
    end
  end

  defmodule MockConsumer do
    use GenStage

    def start_link(args) do
      GenStage.start_link(__MODULE__, args)
    end

    def init(args) do
      {:ok, parent} = Keyword.fetch(args, :parent)
      {:ok, producer} = Keyword.fetch(args, :producer)
      {:consumer, %{parent: parent}, [subscribe_to: [producer]]}
    end

    def handle_events(events, _from, state) do
      send(state.parent, {__MODULE__, :events, events})
      {:noreply, [], state}
    end
  end

  defmodule MockVersion do
    use GenServer

    alias Electric.Postgres.Extension

    def start_link(args) do
      GenServer.start_link(__MODULE__, args, name: __MODULE__)
    end

    def txid(conn, version) do
      GenServer.call(__MODULE__, {:txid, conn, version})
    end

    def init(_args) do
      state = %{
        txid: 1,
        txts: 10000,
        ids: %{}
      }

      {:ok, state}
    end

    def handle_call({:txid, conn, version}, _from, state) do
      %{ids: ids} = state

      case Map.fetch(ids, version) do
        {:ok, {txid, txts}} ->
          {:reply, {:ok, txid, txts}, state}

        :error ->
          %{txid: txid, txts: txts} = state

          {:ok, 1} =
            :epgsql.equery(
              conn,
              "INSERT INTO #{Extension.version_table()} (txid, txts, version) VALUES ($1, $2, $3)",
              [txid, txts, version]
            )

          {:reply, {:ok, txid, txts},
           %{
             state
             | txid: txid + 1,
               txts: txts + 1,
               ids: Map.put(ids, version, {txid, txts})
           }}
      end
    end
  end

  use Electric.Extension.Case, async: false

  alias Electric.Replication.Postgres
  alias Electric.Postgres.{Extension, Extension.SchemaLoader}
  alias Electric.Postgres.Schema
  alias Electric.Postgres.Replication.{Column, Table}

  alias Electric.Replication.Changes.{
    NewRecord,
    Transaction
  }

  @create_a "CREATE TABLE a (aid uuid NOT NULL PRIMARY KEY, avalue text);"
  @create_b "CREATE TABLE b.b (bid1 int4, bid2 int4, bvalue text, PRIMARY KEY (bid1, bid2));"
  @index_b "CREATE INDEX bidx ON b.b (bid1);"
  @sqls [
    @create_a,
    "CREATE SCHEMA b;",
    @create_b,
    @index_b,
    "CALL electric.electrify('a');",
    "CALL electric.electrify('b', 'b');"
  ]

  setup do
    # we run the sql on the db which sets up a valid environment then simulate the
    # same things here to avoid having to commit the transaction
    migrations = [
      {"20230620160340", [@create_a]},
      {"20230620162106", [@create_b, @index_b]}
    ]

    {:ok, _pid} = start_supervised({MockVersion, parent: self()})

    {:ok, origin: "pg", migrations: migrations, versions: Enum.map(migrations, &elem(&1, 0))}
  end

  defp bootstrap(conn, cxt) do
    for sql <- @sqls do
      {:ok, [], []} = :epgsql.squery(conn, sql)
    end

    {:ok, producer} = start_supervised(MockProducer)

    conn_config = [
      origin: cxt.origin,
      __connection__: conn,
      replication: []
    ]

    {:ok, _pid} =
      start_supervised({Extension.SchemaCache, {conn_config, []}})

    {:ok, migration_consumer} =
      start_supervised(
        {Postgres.MigrationConsumer,
         {conn_config, [producer: producer, refresh_subscription: false]}}
      )

    {:ok, _pid} =
      start_supervised({MockConsumer, parent: self(), producer: migration_consumer})

    txs =
      for {version, stmts} <- cxt.migrations do
        migration_transaction(conn, version, stmts)
      end

    produce_txs(producer, txs)

    {:ok, producer}
  end

  defp produce_txs(producer, txs) when is_list(txs) do
    MockProducer.produce(producer, txs)

    assert_receive {MockConsumer, :events, ^txs}, 1000
  end

  defp migration_transaction(conn, version, stmts) do
    changes =
      Enum.map(stmts, fn sql ->
        {:ok, txid, txts} = MockVersion.txid(conn, version)

        %NewRecord{
          record: %{
            "txid" => "#{txid}",
            "txts" => "#{txts}",
            "query" => sql
          },
          relation: Extension.ddl_relation()
        }
      end)

    %Transaction{changes: changes}
  end

  defp table_oid(conn, schema, name) do
    {:ok, [_], [{oid}]} = :epgsql.squery(conn, "SELECT '#{schema}.#{name}'::regclass::oid")
    String.to_integer(oid)
  end

  describe "load" do
    test_tx("load/1 retrieves the current schema", fn conn, cxt ->
      {:ok, _producer} = bootstrap(conn, cxt)

      [_version1, version2] = cxt.versions

      assert {:ok, %{version: ^version2, schema: schema2} = schema_version} =
               Extension.SchemaCache.load(cxt.origin)

      assert {:ok, table_a} = Schema.fetch_table(schema2, {"public", "a"})
      assert {:ok, table_b} = Schema.fetch_table(schema2, {"b", "b"})

      assert {:ok, ^table_a} = SchemaLoader.Version.table(schema_version, {"public", "a"})
      assert {:ok, ^table_b} = SchemaLoader.Version.table(schema_version, {"b", "b"})

      assert table_a.oid == table_oid(conn, "public", "a")

      assert table_b.oid == table_oid(conn, "b", "b")
    end)

    test_tx("load/2 retrieves the schema for the given version", fn conn, cxt ->
      {:ok, _producer} = bootstrap(conn, cxt)

      [version1, _version2] = cxt.versions

      assert {:ok, %{version: ^version1, schema: schema1} = schema_version} =
               Extension.SchemaCache.load(cxt.origin, version1)

      assert {:ok, table_a} = Schema.fetch_table(schema1, {"public", "a"})
      assert {:error, _} = Schema.fetch_table(schema1, {"b", "b"})

      assert {:ok, ^table_a} = SchemaLoader.Version.table(schema_version, {"public", "a"})

      assert table_a.oid == table_oid(conn, "public", "a")
    end)
  end

  describe "primary_keys" do
    test_tx("provides the correct primary keys for a table", fn conn, cxt ->
      {:ok, _producer} = bootstrap(conn, cxt)

      assert {:ok, schema_version} = Extension.SchemaCache.load(cxt.origin)
      assert {:ok, ["aid"]} = SchemaLoader.Version.primary_keys(schema_version, "public", "a")
      assert {:ok, ["aid"]} = SchemaLoader.Version.primary_keys(schema_version, {"public", "a"})

      assert {:ok, ["bid1", "bid2"]} = SchemaLoader.Version.primary_keys(schema_version, "b", "b")

      assert {:ok, ["bid1", "bid2"]} =
               SchemaLoader.Version.primary_keys(schema_version, {"b", "b"})
    end)
  end

  describe "relation" do
    test_tx("relation/2 retrieves the current table info", fn conn, cxt ->
      {:ok, _producer} = bootstrap(conn, cxt)

      assert {:ok, table_info} = Extension.SchemaCache.relation(cxt.origin, {"public", "a"})

      assert table_info == %Table{
               schema: "public",
               name: "a",
               oid: table_oid(conn, "public", "a"),
               primary_keys: ["aid"],
               replica_identity: :all_columns,
               columns: [
                 %Column{
                   name: "aid",
                   type: :uuid,
                   nullable?: false,
                   type_modifier: -1,
                   part_of_identity?: true
                 },
                 %Column{
                   name: "avalue",
                   type: :text,
                   nullable?: true,
                   type_modifier: -1,
                   part_of_identity?: true
                 }
               ]
             }
    end)

    test_tx("relation/2 accepts oids", fn conn, cxt ->
      {:ok, _producer} = bootstrap(conn, cxt)

      oid = table_oid(conn, "public", "a")

      assert {:ok, table_info} = Extension.SchemaCache.relation(cxt.origin, oid)

      assert table_info == %Table{
               schema: "public",
               name: "a",
               oid: table_oid(conn, "public", "a"),
               primary_keys: ["aid"],
               replica_identity: :all_columns,
               columns: [
                 %Column{
                   name: "aid",
                   type: :uuid,
                   nullable?: false,
                   type_modifier: -1,
                   part_of_identity?: true
                 },
                 %Column{
                   name: "avalue",
                   type: :text,
                   nullable?: true,
                   type_modifier: -1,
                   part_of_identity?: true
                 }
               ]
             }
    end)

    test_tx("relation/2 returns an up-to-date version after migrations", fn conn, cxt ->
      {:ok, producer} = bootstrap(conn, cxt)

      # we don't actually have to apply this migration to the db as this is a schema-only thing
      version = "20230621115313"

      stmts = [
        "ALTER TABLE a ADD COLUMN aupdated timestamp with time zone;",
        "ALTER TABLE a ADD COLUMN aname varchar(63);"
      ]

      produce_txs(producer, [migration_transaction(conn, version, stmts)])

      assert {:ok, table_info} = Extension.SchemaCache.relation(cxt.origin, {"public", "a"})

      assert table_info.columns == [
               %Column{
                 name: "aid",
                 type: :uuid,
                 nullable?: false,
                 type_modifier: -1,
                 part_of_identity?: true
               },
               %Column{
                 name: "avalue",
                 type: :text,
                 nullable?: true,
                 type_modifier: -1,
                 part_of_identity?: true
               },
               %Column{
                 name: "aupdated",
                 type: :timestamptz,
                 nullable?: true,
                 type_modifier: -1,
                 part_of_identity?: true
               },
               %Column{
                 name: "aname",
                 type: :varchar,
                 nullable?: true,
                 type_modifier: 63,
                 part_of_identity?: true
               }
             ]
    end)

    test_tx("relation/3 returns specific schema version", fn conn, cxt ->
      {:ok, producer} = bootstrap(conn, cxt)

      [version1, version2] = cxt.versions

      # we don't actually have to apply this migration to the db as this is a schema-only thing
      version3 = "20230621115313"

      stmts = [
        "ALTER TABLE a ADD COLUMN aupdated timestamp with time zone;",
        "ALTER TABLE a ADD COLUMN aname varchar(63);"
      ]

      produce_txs(producer, [migration_transaction(conn, version3, stmts)])

      assert {:ok, table_info} =
               Extension.SchemaCache.relation(cxt.origin, {"public", "a"}, version3)

      assert table_info.columns == [
               %Column{
                 name: "aid",
                 type: :uuid,
                 nullable?: false,
                 type_modifier: -1,
                 part_of_identity?: true
               },
               %Column{
                 name: "avalue",
                 type: :text,
                 nullable?: true,
                 type_modifier: -1,
                 part_of_identity?: true
               },
               %Column{
                 name: "aupdated",
                 type: :timestamptz,
                 nullable?: true,
                 type_modifier: -1,
                 part_of_identity?: true
               },
               %Column{
                 name: "aname",
                 type: :varchar,
                 nullable?: true,
                 type_modifier: 63,
                 part_of_identity?: true
               }
             ]

      assert {:ok, table_info} =
               Extension.SchemaCache.relation(cxt.origin, {"public", "a"}, version1)

      assert table_info.columns == [
               %Column{
                 name: "aid",
                 type: :uuid,
                 nullable?: false,
                 type_modifier: -1,
                 part_of_identity?: true
               },
               %Column{
                 name: "avalue",
                 type: :text,
                 nullable?: true,
                 type_modifier: -1,
                 part_of_identity?: true
               }
             ]

      assert {:error, _} = Extension.SchemaCache.relation(cxt.origin, {"b", "b"}, version1)

      assert {:ok, table_info} = Extension.SchemaCache.relation(cxt.origin, {"b", "b"}, version2)

      assert table_info == %Table{
               schema: "b",
               name: "b",
               oid: table_oid(conn, "b", "b"),
               primary_keys: ["bid1", "bid2"],
               replica_identity: :all_columns,
               columns: [
                 %Column{
                   name: "bid1",
                   type: :int4,
                   nullable?: false,
                   type_modifier: -1,
                   part_of_identity?: true
                 },
                 %Column{
                   name: "bid2",
                   type: :int4,
                   nullable?: false,
                   type_modifier: -1,
                   part_of_identity?: true
                 },
                 %Column{
                   name: "bvalue",
                   type: :text,
                   nullable?: true,
                   type_modifier: -1,
                   part_of_identity?: true
                 }
               ]
             }
    end)
  end

  describe "ready?" do
    test "returns false if no schema cache exists for origin", cxt do
      refute Extension.SchemaCache.ready?(cxt.origin)
    end

    test_tx("returns true if schema cache is online", fn conn, cxt ->
      {:ok, _producer} = bootstrap(conn, cxt)
      assert Extension.SchemaCache.ready?(cxt.origin)
    end)
  end

  describe "table_electrified?/2" do
    test_tx("returns true if table present in schema", fn conn, cxt ->
      {:ok, _producer} = bootstrap(conn, cxt)
      assert {:ok, true} = Extension.SchemaCache.table_electrified?(cxt.origin, {"public", "a"})
      assert {:ok, true} = Extension.SchemaCache.table_electrified?(cxt.origin, {"b", "b"})
    end)

    test_tx("returns false if table unknown", fn conn, cxt ->
      {:ok, _producer} = bootstrap(conn, cxt)
      assert {:ok, false} = Extension.SchemaCache.table_electrified?(cxt.origin, {"b", "c"})
    end)
  end

  describe "index_electrified?/2" do
    test_tx("returns true index exists in schema", fn conn, cxt ->
      {:ok, _producer} = bootstrap(conn, cxt)
      assert {:ok, true} = Extension.SchemaCache.index_electrified?(cxt.origin, {"b", "bidx"})
    end)

    test_tx("returns false for unknown indexes", fn conn, cxt ->
      {:ok, _producer} = bootstrap(conn, cxt)

      assert {:ok, false} =
               Extension.SchemaCache.index_electrified?(cxt.origin, {"public", "aidx"})
    end)
  end
end
