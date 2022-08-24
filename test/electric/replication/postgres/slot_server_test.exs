defmodule Electric.Replication.Postgres.SlotServerTest do
  use ExUnit.Case

  alias Electric.Replication.Postgres.SlotServer
  alias Electric.Postgres.Lsn
  alias Electric.Replication.Changes
  alias Electric.Postgres.SchemaRegistry
  alias Electric.Postgres.LogicalReplication
  alias Electric.Postgres.LogicalReplication.Messages

  setup_all _ do
    SchemaRegistry.put_replicated_tables("fake_publication", [
      %{
        schema: "fake",
        name: "slot_server_test",
        oid: 100_003,
        replica_identity: :all_columns
      }
    ])

    SchemaRegistry.put_table_columns({"fake", "slot_server_test"}, [
      %{
        name: "id",
        type: :uuid,
        type_modifier: 0,
        part_of_identity?: nil
      },
      %{
        name: "content",
        type: :varchar,
        type_modifier: -1,
        part_of_identity?: nil
      }
    ])

    on_exit(fn -> SchemaRegistry.clear_replicated_tables("fake_publication") end)

    :ok
  end

  describe "Slot server callbacks" do
    test "send the replication messages asap if replication is started" do
      {:ok, state} = init_slot_server("fake_slot")
      send_back = send_back_message(self())

      state = %{state | send_fn: send_back}

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

      state = %{state | send_fn: send_back}

      assert {:noreply, [], state} =
               %Changes.NewRecord{
                 record: %{"content" => "a", "id" => "fakeid"},
                 relation: {"fake", "slot_server_test"}
               }
               |> build_events()
               |> SlotServer.handle_events(self(), state)

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
      producer = SlotServer.get_producer_pid(server)

      {:ok, server: server, send_fn: send_back_message(self()), producer: producer}
    end

    test "downstream_connected? calls downstream producer to check if its connected", %{
      server: server,
      producer: producer
    } do
      refute SlotServer.downstream_connected?(server)
      DownstreamProducerMock.set_expected_producer_connected(producer, true)
      assert SlotServer.downstream_connected?(server)
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

  defp build_events(changes),
    do: [
      {%Changes.Transaction{changes: List.wrap(changes), commit_timestamp: DateTime.utc_now()},
       {0, 0}}
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
    {:consumer, state, _opts} =
      slot
      |> start_args()
      |> SlotServer.init()

    {:ok, state}
  end

  defp start_args(slot) do
    %{
      replication: %{subscription: slot},
      downstream: %{producer: DownstreamProducerMock, producer_opts: []}
    }
  end
end
