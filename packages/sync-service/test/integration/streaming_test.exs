defmodule Electric.Integration.StreamingTest do
  @moduledoc """
  Integration tests that spin up an Electric HTTP API + stack for a unique test DB,
  then use Electric.Client to stream a shape over HTTP.

  These tests are opt-in by default. Run them with:

      mix test --include integration

  Or run only integration tests with:

      mix test --only integration
  """
  use ExUnit.Case, async: false

  import Support.ComponentSetup
  import Support.DbSetup
  import Support.DbStructureSetup

  alias Electric.Client
  alias Electric.Client.Message.ChangeMessage
  alias Electric.Client.Message.ControlMessage

  @moduletag :integration
  @moduletag :tmp_dir

  describe "Electric.Client streaming over HTTP" do
    setup [:with_unique_db, :with_basic_tables, :with_sql_execute]
    setup :with_complete_stack

    setup ctx do
      :ok = Electric.StatusMonitor.wait_until_active(ctx.stack_id, timeout: 2000)

      # Start Bandit HTTP server on a random available port
      router_opts = build_router_opts(ctx)

      {:ok, server_pid} =
        start_supervised(
          {Bandit,
           plug: {Electric.Plug.Router, router_opts},
           port: 0,
           ip: :loopback,
           thousand_island_options: [num_acceptors: 1]}
        )

      # Get the actual port that was assigned
      {:ok, {_ip, port}} = ThousandIsland.listener_info(server_pid)

      base_url = "http://localhost:#{port}"

      {:ok, client} = Client.new(base_url: base_url)

      %{
        client: client,
        base_url: base_url,
        server_pid: server_pid,
        port: port
      }
    end

    @tag with_sql: [
           "INSERT INTO items VALUES ('00000000-0000-0000-0000-000000000001', 'initial value')"
         ]
    test "initial snapshot contains pre-existing row", %{client: client} do
      # Stream with live: false to get only the initial snapshot
      messages =
        client
        |> Client.stream("items", live: false)
        |> Enum.to_list()

      # Should have at least one insert message and control messages
      insert_messages = Enum.filter(messages, &match?(%ChangeMessage{}, &1))
      control_messages = Enum.filter(messages, &match?(%ControlMessage{}, &1))

      assert length(insert_messages) == 1
      [insert] = insert_messages

      assert insert.headers.operation == :insert
      assert insert.value["id"] == "00000000-0000-0000-0000-000000000001"
      assert insert.value["value"] == "initial value"

      # Should end with up-to-date control message
      assert Enum.any?(control_messages, &(&1.control == :up_to_date))
    end

    @tag with_sql: [
           "INSERT INTO items VALUES ('00000000-0000-0000-0000-000000000001', 'initial value')"
         ]
    test "receives live changes after initial snapshot", %{client: client, db_conn: db_conn} do
      test_pid = self()

      # Start streaming in a separate task
      stream_task =
        Task.async(fn ->
          client
          |> Client.stream("items", live: true)
          |> Stream.each(fn msg ->
            send(test_pid, {:message, msg})
          end)
          |> Stream.take_while(fn
            %ChangeMessage{value: %{"value" => "new value"}} -> false
            _ -> true
          end)
          |> Stream.run()
        end)

      # Wait for initial snapshot to be received (the insert from setup)
      assert_receive {:message, %ChangeMessage{value: %{"value" => "initial value"}}}, 5000

      # Wait for up-to-date message indicating snapshot is complete
      assert_receive {:message, %ControlMessage{control: :up_to_date}}, 5000

      # Insert a new row after the stream is live
      Postgrex.query!(
        db_conn,
        "INSERT INTO items VALUES ('00000000-0000-0000-0000-000000000002', 'new value')",
        []
      )

      # Should receive the new insert
      assert_receive {:message, %ChangeMessage{} = new_insert}, 5000

      assert new_insert.headers.operation == :insert
      assert new_insert.value["id"] == "00000000-0000-0000-0000-000000000002"
      assert new_insert.value["value"] == "new value"

      # Cleanup: the task should terminate due to take_while
      Task.await(stream_task, 5000)
    end

    test "streaming empty table returns up-to-date", %{client: client} do
      messages =
        client
        |> Client.stream("items", live: false)
        |> Enum.to_list()

      # Should have just control messages, no data
      insert_messages = Enum.filter(messages, &match?(%ChangeMessage{}, &1))
      control_messages = Enum.filter(messages, &match?(%ControlMessage{}, &1))

      assert Enum.empty?(insert_messages)
      assert Enum.any?(control_messages, &(&1.control == :up_to_date))
    end
  end
end
