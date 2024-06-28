defmodule Electric.Replication.Postgres.SlotServerTest do
  use ExUnit.Case

  alias Electric.Replication.Postgres.SlotServer
  alias Electric.Postgres.Lsn
  alias Electric.Replication.Changes
  alias Electric.Postgres.LogicalReplication
  alias Electric.Postgres.LogicalReplication.Messages
  alias Electric.Postgres.Extension.SchemaCache
  alias Electric.Postgres.MockSchemaLoader

  setup _ do
    migrations = [
      {"001",
       [
         "CREATE TABLE fake.slot_server_test (id uuid PRIMARY KEY NOT NULL, content varchar)"
       ]}
    ]

    backend =
      MockSchemaLoader.backend_spec(
        migrations: migrations,
        oids: %{
          table: %{
            {"fake", "slot_server_test"} => 100_003
          }
        }
      )

    start_supervised({SchemaCache, {[origin: "fake_publication"], [backend: backend]}})

    :ok
  end

  describe "Slot server callbacks" do
    test "send the replication messages asap if replication is started" do
      {:ok, state} = init_slot_server("fake_slot")
      send_back = send_back_message(self())

      state = %{state | send_fn: send_back, producer_pid: self()}

      assert {:noreply, [], _state} =
               %Changes.NewRecord{
                 record: %{"content" => "a", "id" => "fakeid"},
                 relation: {"fake", "slot_server_test"}
               }
               |> build_events()
               |> SlotServer.handle_events(self(), state)

      assert_received {:sent, %Messages.Begin{}}
      assert_received {:sent, %Messages.Relation{}}
      assert_received {:sent, %Messages.Insert{}}
      assert_received {:sent, %Messages.Commit{}}
    end

    test "send the relation only the first time" do
      {:ok, state} = init_slot_server("fake_slot")
      send_back = send_back_message(self())

      state = %{state | send_fn: send_back, producer_pid: self()}

      assert {:noreply, [], state} =
               %Changes.NewRecord{
                 record: %{"content" => "a", "id" => "fakeid"},
                 relation: {"fake", "slot_server_test"}
               }
               |> build_events(1)
               |> SlotServer.handle_events(self(), state)

      assert_received {:sent_all_up_to, 1}

      assert {:noreply, [], _state} =
               %Changes.NewRecord{
                 record: %{"content" => "a", "id" => "fakeid"},
                 relation: {"fake", "slot_server_test"}
               }
               |> build_events(2)
               |> SlotServer.handle_events(self(), state)

      assert_received {:sent_all_up_to, 2}
      assert_received {:sent, %Messages.Begin{}}
      assert_received {:sent, %Messages.Relation{}}
      assert_received {:sent, %Messages.Insert{}}
      assert_received {:sent, %Messages.Commit{}}
      assert_received {:sent, %Messages.Begin{}}
      # Relation shouldn't be sent the second time around
      refute_received {:sent, %Messages.Relation{}}
      assert_received {:sent, %Messages.Insert{}}
      assert_received {:sent, %Messages.Commit{}}
    end
  end

  describe "Slot server lifecycle" do
    setup do
      server = start_supervised!({SlotServer, start_args("fake_slot")})
      producer = start_supervised!({DownstreamProducerMock, {:via, :gproc, producer_name()}})

      {:ok, server: server, send_fn: send_back_message(self()), producer: producer}
    end

    test "starts and reports current LSN", %{server: server} do
      assert %Lsn{segment: 0, offset: 1} = SlotServer.get_current_lsn(server)
    end

    test "starts replication and immediately sends keepalive", %{
      server: server,
      send_fn: send_back
    } do
      assert :ok =
               SlotServer.start_replication(
                 server,
                 send_back,
                 "fake_publication",
                 Lsn.from_string("0/0")
               )

      assert_receive {:sent, :keepalive}
    end

    test "starts replication and sends replication messages over", %{
      producer: producer,
      server: server,
      send_fn: send_back
    } do
      start_replication(server, send_back)

      assert_receive {:sent, :keepalive}

      push_transaction_event(producer, %Changes.NewRecord{
        record: %{"content" => "a", "id" => "fakeid"},
        relation: {"fake", "slot_server_test"}
      })

      assert_receive {:sent, %Messages.Begin{}}
      assert_receive {:sent, %Messages.Relation{}}
      assert_receive {:sent, %Messages.Insert{}}
      assert_receive {:sent, %Messages.Commit{}}
    end

    test "doesn't allow starting replication if already replicating", %{
      server: server,
      send_fn: send_back
    } do
      start_replication(server, send_back)

      assert {:error, :replication_already_started} =
               SlotServer.start_replication(
                 server,
                 send_back,
                 "other_publication",
                 Lsn.from_string("0/0")
               )
    end
  end

  describe "Interaction with TCP server" do
    test "stops replication when process that started replication dies" do
      server = start_supervised!({SlotServer, start_args("test_slot")})

      _producer = start_supervised!({DownstreamProducerMock, {:via, :gproc, producer_name()}})

      task = Task.async(fn -> start_replication(server, send_back_message(self())) end)

      Task.await(task)
      Task.shutdown(task)

      # Will not succeed if replication is already ongoing
      assert :ok =
               SlotServer.start_replication(
                 server,
                 send_back_message(self()),
                 "other_publication",
                 Lsn.from_string("0/0")
               )
    end
  end

  defp start_replication(server, send_fn, publication \\ "fake_publication", lsn \\ "0/0") do
    assert :ok =
             SlotServer.start_replication(
               server,
               send_fn,
               publication,
               Lsn.from_string(lsn)
             )

    server
  end

  defp push_transaction_event(producer_pid, changes),
    do: DownstreamProducerMock.produce(producer_pid, build_events(changes))

  defp build_events(changes, position \\ 0),
    do: [
      {%Changes.Transaction{changes: List.wrap(changes), commit_timestamp: DateTime.utc_now()},
       position}
    ]

  defp send_back_message(pid) do
    fn
      <<?d, _::32, ?w, _::192>> <> data ->
        send(pid, {:sent, LogicalReplication.decode_message(data)})

      <<?d, _::32, ?k>> <> _ ->
        send(pid, {:sent, :keepalive})
    end
  end

  defp init_slot_server(slot) do
    {:consumer, state} =
      slot
      |> start_args()
      |> SlotServer.init()

    {:ok, state}
  end

  defp start_args(slot) do
    [
      conn_config: [
        origin: slot,
        replication: [subscription: slot],
        downstream: [producer: DownstreamProducerMock]
      ],
      producer: {:via, :gproc, producer_name()},
      preprocess_change_fn: nil,
      preprocess_relation_list_fn: & &1
    ]
  end

  defp producer_name do
    {:n, :l, {DownstreamProducerMock, :tmp_producer}}
  end
end
