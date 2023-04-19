defmodule Electric.Replication.Postgres.MigrationConsumerTest do
  use ExUnit.Case, async: true

  alias Electric.Replication.Changes.{
    NewRecord,
    Transaction
  }

  alias Electric.Replication.Postgres.MigrationConsumer

  alias Electric.Postgres.MockSchemaLoader

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
    def handle_call({:emit, events}, _from, state) do
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

      {:ok, pid} =
        start_supervised(
          {MigrationConsumer,
           {[origin: origin],
            [producer: producer_name, backend: {MockSchemaLoader, parent: self()}]}}
        )

      {:ok, _consumer} = start_supervised({FakeConsumer, {pid, self()}})

      {:ok, origin: origin, producer: producer}
    end

    test "migration consumer stage captures migration records", cxt do
      %{origin: origin, producer: producer} = cxt
      version = "20220421"
      assert_receive {MockSchemaLoader, {:connect, [origin: ^origin]}}

      events = [
        %Transaction{
          changes: [
            %NewRecord{
              relation: {"electric", "ddl_commands"},
              record: %{
                "id" => "6",
                "query" => "create table something_else (id uuid primary key);",
                "version" => "20220421",
                "txid" => "749",
                "txts" => "2023-04-20 19:41:56.236357+00"
              },
              tags: []
            },
            %NewRecord{
              relation: {"electric", "ddl_commands"},
              record: %{
                "id" => "7",
                "query" => "create table other_thing (id uuid primary key);",
                "version" => "20220421",
                "txid" => "749",
                "txts" => "2023-04-20 19:41:56.236357+00"
              },
              tags: []
            },
            %NewRecord{
              relation: {"electric", "ddl_commands"},
              record: %{
                "id" => "8",
                "query" => "create table yet_another_thing (id uuid primary key);",
                "version" => "20220421",
                "txid" => "749",
                "txts" => "2023-04-20 19:41:56.236357+00"
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

      GenStage.call(producer, {:emit, events})

      assert_receive {FakeConsumer, :events, ^events}, 500
      assert_receive {MockSchemaLoader, :load}, 500
      assert_receive {MockSchemaLoader, {:save, ^version, schema}}
      # only receive 1 save instruction
      refute_receive {MockSchemaLoader, {:save, _, _schema}}

      assert Enum.map(schema.tables, & &1.name.name) == [
               "something_else",
               "other_thing",
               "yet_another_thing"
             ]
    end

    test "migration consumer filters non-migration records", cxt do
      %{origin: origin, producer: producer} = cxt
      version = "20220421"
      assert_receive {MockSchemaLoader, {:connect, [origin: ^origin]}}

      raw_events = [
        %Transaction{
          changes: [
            %NewRecord{
              relation: {"electric", "ddl_commands"},
              record: %{
                "id" => "6",
                "query" => "create table something_else (id uuid primary key);",
                "version" => "20220421",
                "txid" => "749",
                "txts" => "2023-04-20 19:41:56.236357+00"
              },
              tags: []
            },
            %NewRecord{
              relation: {"electric", "schema"},
              record: %{
                "id" => "7",
                "version" => "20220421",
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
                "version" => "20220421",
                "txid" => "749",
                "txts" => "2023-04-20 19:41:56.236357+00"
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

      GenStage.call(producer, {:emit, raw_events})

      assert_receive {FakeConsumer, :events, ^filtered_events}, 500
      assert_receive {MockSchemaLoader, :load}, 500
      assert_receive {MockSchemaLoader, {:save, ^version, _schema}}
    end
  end
end
