defmodule Electric.Replication.Postgres.MigrationConsumerTest do
  use ExUnit.Case, async: true

  alias Electric.Postgres.MockSchemaLoader

  alias Electric.Replication.Changes.NewRecord
  alias Electric.Replication.Changes.Transaction
  alias Electric.Replication.Postgres.MigrationConsumer

  defmodule FakeProducer do
    use GenStage

    def start_link(name) do
      GenStage.start_link(__MODULE__, [], name: name)
    end

    @impl GenStage
    def init(_args) do
      {:producer, []}
    end

    @impl GenStage
    def handle_demand(_demand, state) do
      {:noreply, [], state}
    end

    @impl GenStage
    def handle_call({:emit, loader, events, version}, _from, state) do
      for tx <- events, is_struct(tx, Transaction) do
        for change <- tx.changes do
          MockSchemaLoader.receive_tx(loader, change.record, version)
        end
      end

      {:reply, :ok, events, state}
    end
  end

  defmodule FakeConsumer do
    use GenStage

    def start_link({producer, parent}) do
      GenStage.start_link(__MODULE__, {producer, parent})
    end

    @impl GenStage
    def init({producer, parent}) do
      {:consumer, parent, subscribe_to: [producer]}
    end

    @impl GenStage
    def handle_events(events, _from, parent) do
      send(parent, {__MODULE__, :events, events})
      {:noreply, [], parent}
    end
  end

  describe "migrations" do
    setup do
      origin = "logical_replication_producer_test_1"
      producer_name = Electric.name(FakeProducer, origin)

      {:ok, producer} = start_supervised({FakeProducer, producer_name})

      version = "20220421"

      # provide fake oids for the new tables
      oids = %{
        table: %{
          {"public", "something_else"} => 1111,
          {"public", "other_thing"} => 2222,
          {"public", "yet_another_thing"} => 3333,
          {"electric", "shadow__public__something_else"} => 201_111,
          {"electric", "shadow__public__other_thing"} => 202_222,
          {"electric", "shadow__public__yet_another_thing"} => 203_333
        }
      }

      pks = %{
        {"public", "mistakes"} => ["id"]
      }

      backend =
        MockSchemaLoader.start_link([oids: oids, pks: pks], name: __MODULE__.Loader)

      {:ok, pid} =
        start_supervised(
          {MigrationConsumer,
           {[origin: origin, replication: []],
            [
              producer: producer_name,
              backend: backend
            ]}}
        )

      {:ok, _consumer} = start_supervised({FakeConsumer, {pid, self()}})

      {:ok, origin: origin, producer: producer, version: version, loader: backend}
    end

    test "migration consumer refreshes subscription after receiving a migration", cxt do
      %{producer: producer, origin: origin, version: version} = cxt
      assert_receive {MockSchemaLoader, {:connect, _}}

      events = [
        %Transaction{
          changes: [
            %NewRecord{
              relation: {"electric", "ddl_commands"},
              record: %{
                "id" => "6",
                "query" => "create table something_else (id uuid primary key);",
                "txid" => "101",
                "txts" => "201"
              },
              tags: []
            }
          ]
        }
      ]

      GenStage.call(producer, {:emit, cxt.loader, events, version})

      assert_receive {MockSchemaLoader, {:refresh_subscription, ^origin}}, 500
    end

    test "migration consumer stage captures migration records", cxt do
      %{origin: origin, producer: producer, version: version} = cxt
      assert_receive {MockSchemaLoader, {:connect, _}}

      events = [
        %Transaction{
          changes: [
            %NewRecord{
              relation: {"electric", "ddl_commands"},
              record: %{
                "id" => "6",
                "query" => "create table something_else (id uuid primary key);",
                "txid" => "100",
                "txts" => "200"
              },
              tags: []
            },
            %NewRecord{
              relation: {"electric", "ddl_commands"},
              record: %{
                "id" => "7",
                "query" => "create table other_thing (id uuid primary key);",
                "txid" => "100",
                "txts" => "200"
              },
              tags: []
            },
            %NewRecord{
              relation: {"electric", "ddl_commands"},
              record: %{
                "id" => "8",
                "query" => "create table yet_another_thing (id uuid primary key);",
                "txid" => "100",
                "txts" => "200"
              },
              tags: []
            }
          ],
          commit_timestamp: ~U[2023-05-02 10:08:00.948788Z],
          origin: origin,
          publication: "mock_pub",
          origin_type: :postgresql
        }
      ]

      GenStage.call(producer, {:emit, cxt.loader, events, version})

      assert_receive {FakeConsumer, :events, ^events}, 500
      assert_receive {MockSchemaLoader, :load}, 500
      assert_receive {MockSchemaLoader, {:save, ^version, schema, [_, _, _]}}
      # only receive 1 save instruction
      refute_receive {MockSchemaLoader, {:save, _, _schema}}

      assert Enum.map(schema.tables, & &1.name.name) == [
               "something_else",
               "other_thing",
               "yet_another_thing",
               "shadow__public__something_else",
               "shadow__public__other_thing",
               "shadow__public__yet_another_thing"
             ]
    end

    test "migration consumer filters non-migration records", cxt do
      %{origin: origin, producer: producer, version: version} = cxt
      assert_receive {MockSchemaLoader, {:connect, _}}

      raw_events = [
        %Transaction{
          changes: [
            %NewRecord{
              relation: {"electric", "ddl_commands"},
              record: %{
                "id" => "6",
                "query" => "create table something_else (id uuid primary key);",
                "txid" => "101",
                "txts" => "201"
              },
              tags: []
            },
            %NewRecord{
              relation: {"electric", "schema"},
              record: %{
                "id" => "7",
                "version" => version,
                "schema" => "{}"
              },
              tags: []
            }
          ],
          commit_timestamp: ~U[2023-05-02 10:08:00.948788Z],
          origin: origin,
          publication: "mock_pub",
          origin_type: :postgresql
        }
      ]

      filtered_events = [
        %Transaction{
          changes: [
            %NewRecord{
              relation: {"electric", "ddl_commands"},
              record: %{
                "id" => "6",
                "query" => "create table something_else (id uuid primary key);",
                "txid" => "101",
                "txts" => "201"
              },
              tags: []
            }
          ],
          commit_timestamp: ~U[2023-05-02 10:08:00.948788Z],
          origin: origin,
          publication: "mock_pub",
          origin_type: :postgresql
        }
      ]

      GenStage.call(producer, {:emit, cxt.loader, raw_events, version})

      assert_receive {FakeConsumer, :events, ^filtered_events}, 1000
      assert_receive {MockSchemaLoader, :load}, 500

      assert_receive {MockSchemaLoader,
                      {:save, ^version, _schema,
                       ["create table something_else (id uuid primary key);"]}}
    end
  end
end
