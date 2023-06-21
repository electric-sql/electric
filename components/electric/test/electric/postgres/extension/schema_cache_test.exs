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

  use Electric.Extension.Case, async: false

  alias Electric.Replication.Postgres
  alias Electric.Postgres.Extension
  alias Electric.Postgres.Schema

  alias Electric.Replication.Changes.{
    NewRecord,
    Transaction
  }

  @create_a "CREATE TABLE a (aid uuid NOT NULL PRIMARY KEY, avalue text);"
  @create_b "CREATE TABLE b.b (bid1 int4, bid2 int4, bvalue text, PRIMARY KEY (bid1, bid2));"
  @sqls [
    @create_a,
    "CREATE SCHEMA b;",
    @create_b,
    "CALL electric.electrify('a');",
    "CALL electric.electrify('b', 'b');"
  ]

  setup do
    # we run the sql on the db which sets up a valid environment then simulate the 
    # same things here to avoid having to commit the transaction
    migrations = [
      {"20230620160340", [@create_a]},
      {"20230620162106", [@create_b]}
    ]

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

    {:ok, _pid} = start_supervised({Extension.SchemaCache, {conn_config, [producer: producer]}})

    {:ok, migration_consumer} =
      start_supervised(
        {Postgres.MigrationConsumer,
         {conn_config, [producer: producer, refresh_subscription: false]}}
      )

    {:ok, _pid} = start_supervised({MockConsumer, parent: self(), producer: migration_consumer})

    txs =
      for {version, stmts} <- cxt.migrations do
        migration_transaction(version, stmts)
      end

    MockProducer.produce(producer, txs)

    assert_receive {MockConsumer, :events, ^txs}, 1000

    {:ok, producer}
  end

  defp migration_transaction(version, stmts) do
    changes =
      Enum.map(stmts, fn sql ->
        %NewRecord{
          record: %{"txid" => "", "txts" => "", "version" => version, "query" => sql},
          relation: Extension.ddl_relation()
        }
      end)

    %Transaction{changes: changes}
  end

  describe "load" do
    test_tx "load/1 retrieves the current schema", fn conn, cxt ->
      {:ok, _producer} = bootstrap(conn, cxt)

      [_version1, version2] = cxt.versions

      assert {:ok, ^version2, schema2} = Extension.SchemaCache.load(cxt.origin)

      assert {:ok, table_a} = Schema.fetch_table(schema2, {"public", "a"})
      assert {:ok, table_b} = Schema.fetch_table(schema2, {"b", "b"})

      assert {:ok, [_], [{oid}]} = :epgsql.squery(conn, "SELECT 'public.a'::regclass::oid")
      assert String.to_integer(oid) == table_a.oid

      assert {:ok, [_], [{oid}]} = :epgsql.squery(conn, "SELECT 'b.b'::regclass::oid")
      assert String.to_integer(oid) == table_b.oid
    end

    test_tx "load/2 retrieves the schema for the given version", fn conn, cxt ->
      {:ok, _producer} = bootstrap(conn, cxt)

      [version1, _version2] = cxt.versions

      assert {:ok, ^version1, schema1} = Extension.SchemaCache.load(cxt.origin, version1)

      assert {:ok, table_a} = Schema.fetch_table(schema1, {"public", "a"})
      assert :error = Schema.fetch_table(schema1, {"b", "b"})

      assert {:ok, [_], [{oid}]} = :epgsql.squery(conn, "SELECT 'public.a'::regclass::oid")
      assert String.to_integer(oid) == table_a.oid
    end
  end

  describe "primary_keys" do
    test_tx "provides the correct primary keys for a table", fn conn, cxt ->
      {:ok, _producer} = bootstrap(conn, cxt)

      assert {:ok, ["aid"]} = Extension.SchemaCache.primary_keys(cxt.origin, "public", "a")

      assert {:ok, ["bid1", "bid2"]} = Extension.SchemaCache.primary_keys(cxt.origin, "b", "b")
    end
  end
end
