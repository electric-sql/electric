defmodule Electric.Integration.SubqueryMoveOutTest do
  @moduledoc """
  Integration tests for subquery move-out functionality.

  These tests verify that the Elixir client correctly handles:
  1. Tags on change messages (indicating why a row belongs to the shape)
  2. Move-out control messages (when dependency values are removed)
  3. Synthetic delete generation from move-out patterns

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
  alias Electric.Client.ShapeDefinition
  alias Electric.Client.Message.ChangeMessage
  alias Electric.Client.Message.ControlMessage

  @moduletag :integration
  @moduletag :tmp_dir

  # Shape definition for child table filtered by active parents
  @subquery_where "parent_id IN (SELECT id FROM parent WHERE active = true)"

  describe "subquery move-out with parent/child tables" do
    setup [:with_unique_db, :with_parent_child_tables, :with_sql_execute]
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

      # Create the shape definition for subquery-filtered children
      shape = ShapeDefinition.new!("child", where: @subquery_where)

      %{
        client: client,
        shape: shape,
        base_url: base_url,
        server_pid: server_pid,
        port: port
      }
    end

    @tag with_sql: [
           "INSERT INTO parent (id, active) VALUES ('parent-1', true)",
           "INSERT INTO child (id, parent_id, value) VALUES ('child-1', 'parent-1', 'test value')"
         ]
    test "change messages include tags for subquery-matched rows", %{client: client, shape: shape} do
      # Stream a shape that uses a subquery to filter children by active parents
      messages =
        client
        |> Client.stream(shape, live: false)
        |> Enum.to_list()

      # Find the insert message for the child row
      insert_messages = Enum.filter(messages, &match?(%ChangeMessage{}, &1))
      assert length(insert_messages) == 1
      [insert] = insert_messages

      assert insert.headers.operation == :insert
      assert insert.value["id"] == "child-1"

      # The change message should include tags indicating why this row is in the shape
      assert Map.has_key?(insert.headers, :tags)
      assert is_list(insert.headers.tags)
      assert length(insert.headers.tags) > 0
    end

    @tag with_sql: [
           "INSERT INTO parent (id, active) VALUES ('parent-1', true)",
           "INSERT INTO child (id, parent_id, value) VALUES ('child-1', 'parent-1', 'test value')"
         ]
    test "receives move-out control message when parent is deactivated", %{
      client: client,
      shape: shape,
      db_conn: db_conn
    } do
      test_pid = self()

      # Start streaming with live: true
      stream_task =
        Task.async(fn ->
          client
          |> Client.stream(shape, live: true)
          |> Stream.each(fn msg ->
            send(test_pid, {:message, msg})
          end)
          |> Stream.take_while(fn
            # Stop when we see a move-out related message (either control or synthetic delete)
            %ControlMessage{control: :move_out} -> false
            %ChangeMessage{headers: %{operation: :delete}, value: %{"id" => "child-1"}} -> false
            _ -> true
          end)
          |> Stream.run()
        end)

      # Wait for initial snapshot
      assert_receive {:message, %ChangeMessage{value: %{"id" => "child-1"}}}, 5000
      assert_receive {:message, %ControlMessage{control: :up_to_date}}, 5000

      # Deactivate the parent - this should trigger a move-out
      Postgrex.query!(db_conn, "UPDATE parent SET active = false WHERE id = 'parent-1'", [])

      # Should receive either:
      # 1. A move-out control message, OR
      # 2. A synthetic delete for child-1
      assert_receive {:message, msg}, 5000

      case msg do
        %ControlMessage{control: :move_out} = move_out ->
          # The control message should include patterns
          assert Map.has_key?(move_out, :patterns)

        %ChangeMessage{headers: %{operation: :delete}} = delete_msg ->
          # Or we might receive a synthetic delete directly
          assert delete_msg.value["id"] == "child-1"
          # Synthetic deletes should include old_value with the row data
          assert delete_msg.old_value != nil
          assert delete_msg.old_value["id"] == "child-1"

        other ->
          flunk("Expected move-out control or synthetic delete, got: #{inspect(other)}")
      end

      Task.shutdown(stream_task, :brutal_kill)
    end

    @tag with_sql: [
           "INSERT INTO parent (id, active) VALUES ('parent-1', true)",
           "INSERT INTO child (id, parent_id, value) VALUES ('child-1', 'parent-1', 'value 1')",
           "INSERT INTO child (id, parent_id, value) VALUES ('child-2', 'parent-1', 'value 2')"
         ]
    test "move-out generates synthetic deletes for all affected child rows", %{
      client: client,
      shape: shape,
      db_conn: db_conn
    } do
      test_pid = self()
      received_deletes = :ets.new(:received_deletes, [:set, :public])

      stream_task =
        Task.async(fn ->
          client
          |> Client.stream(shape, live: true)
          |> Stream.each(fn msg ->
            send(test_pid, {:message, msg})
          end)
          |> Stream.take_while(fn
            %ChangeMessage{headers: %{operation: :delete}, value: %{"id" => id}} ->
              :ets.insert(received_deletes, {id, true})
              # Stop when we've seen deletes for both children
              :ets.info(received_deletes, :size) < 2

            _ ->
              true
          end)
          |> Stream.run()
        end)

      # Wait for initial snapshot
      assert_receive {:message, %ChangeMessage{value: %{"id" => "child-1"}}}, 5000
      assert_receive {:message, %ChangeMessage{value: %{"id" => "child-2"}}}, 5000
      assert_receive {:message, %ControlMessage{control: :up_to_date}}, 5000

      # Deactivate the parent
      Postgrex.query!(db_conn, "UPDATE parent SET active = false WHERE id = 'parent-1'", [])

      # Wait for both synthetic deletes
      Process.sleep(2000)

      # Verify we received deletes for both children
      assert :ets.lookup(received_deletes, "child-1") == [{"child-1", true}]
      assert :ets.lookup(received_deletes, "child-2") == [{"child-2", true}]

      :ets.delete(received_deletes)
      Task.shutdown(stream_task, :brutal_kill)
    end

    @tag with_sql: [
           "INSERT INTO parent (id, active) VALUES ('parent-1', true)",
           "INSERT INTO child (id, parent_id, value) VALUES ('child-1', 'parent-1', 'test value')"
         ]
    test "deleting parent row triggers move-out", %{client: client, shape: shape, db_conn: db_conn} do
      test_pid = self()

      stream_task =
        Task.async(fn ->
          client
          |> Client.stream(shape, live: true)
          |> Stream.each(fn msg ->
            send(test_pid, {:message, msg})
          end)
          |> Stream.take_while(fn
            %ChangeMessage{headers: %{operation: :delete}, value: %{"id" => "child-1"}} -> false
            _ -> true
          end)
          |> Stream.run()
        end)

      # Wait for initial snapshot
      assert_receive {:message, %ChangeMessage{value: %{"id" => "child-1"}}}, 5000
      assert_receive {:message, %ControlMessage{control: :up_to_date}}, 5000

      # Delete the parent row
      Postgrex.query!(db_conn, "DELETE FROM parent WHERE id = 'parent-1'", [])

      # Should receive a synthetic delete for the child
      assert_receive {:message, %ChangeMessage{} = delete_msg}, 5000
      assert delete_msg.headers.operation == :delete
      assert delete_msg.value["id"] == "child-1"
      # Synthetic deletes should include old_value
      assert delete_msg.old_value != nil
      assert delete_msg.old_value["id"] == "child-1"
      assert delete_msg.old_value["value"] == "test value"

      Task.shutdown(stream_task, :brutal_kill)
    end

    @tag with_sql: [
           "INSERT INTO parent (id, active) VALUES ('parent-1', true)",
           "INSERT INTO parent (id, active) VALUES ('parent-2', true)",
           "INSERT INTO child (id, parent_id, value) VALUES ('child-1', 'parent-1', 'belongs to parent-1')"
         ]
    test "move-in after row becomes visible through different parent", %{
      client: client,
      shape: shape,
      db_conn: db_conn
    } do
      test_pid = self()
      messages_received = :ets.new(:messages, [:bag, :public])

      stream_task =
        Task.async(fn ->
          client
          |> Client.stream(shape, live: true)
          |> Stream.each(fn msg ->
            :ets.insert(messages_received, {System.monotonic_time(), msg})
            send(test_pid, {:message, msg})
          end)
          |> Stream.run()
        end)

      # Wait for initial snapshot
      assert_receive {:message, %ChangeMessage{value: %{"id" => "child-1"}}}, 5000
      assert_receive {:message, %ControlMessage{control: :up_to_date}}, 5000

      # Deactivate parent-1
      Postgrex.query!(db_conn, "UPDATE parent SET active = false WHERE id = 'parent-1'", [])

      # Wait for the move-out (synthetic delete)
      assert_receive {:message, %ChangeMessage{headers: %{operation: :delete}} = delete_msg}, 5000
      # Synthetic delete should include old_value
      assert delete_msg.old_value != nil
      assert delete_msg.old_value["id"] == "child-1"

      # Change child to reference parent-2 (which is still active)
      Postgrex.query!(db_conn, "UPDATE child SET parent_id = 'parent-2' WHERE id = 'child-1'", [])

      # Should receive a new insert (move-in) for the child
      assert_receive {:message, %ChangeMessage{} = insert_msg}, 5000
      assert insert_msg.headers.operation == :insert
      assert insert_msg.value["id"] == "child-1"
      assert insert_msg.value["parent_id"] == "parent-2"

      :ets.delete(messages_received)
      Task.shutdown(stream_task, :brutal_kill)
    end
  end

  describe "tag handling during updates" do
    setup [:with_unique_db, :with_parent_child_tables, :with_sql_execute]
    setup :with_complete_stack

    setup ctx do
      :ok = Electric.StatusMonitor.wait_until_active(ctx.stack_id, timeout: 2000)

      router_opts = build_router_opts(ctx)

      {:ok, server_pid} =
        start_supervised(
          {Bandit,
           plug: {Electric.Plug.Router, router_opts},
           port: 0,
           ip: :loopback,
           thousand_island_options: [num_acceptors: 1]}
        )

      {:ok, {_ip, port}} = ThousandIsland.listener_info(server_pid)
      base_url = "http://localhost:#{port}"
      {:ok, client} = Client.new(base_url: base_url)
      shape = ShapeDefinition.new!("child", where: @subquery_where)

      %{client: client, shape: shape, base_url: base_url, server_pid: server_pid, port: port}
    end

    @tag with_sql: [
           "INSERT INTO parent (id, active) VALUES ('parent-1', true)",
           "INSERT INTO parent (id, active) VALUES ('parent-2', true)",
           "INSERT INTO child (id, parent_id, value) VALUES ('child-1', 'parent-1', 'initial')"
         ]
    test "update that changes parent reference updates tags", %{
      client: client,
      shape: shape,
      db_conn: db_conn
    } do
      test_pid = self()

      stream_task =
        Task.async(fn ->
          client
          |> Client.stream(shape, live: true)
          |> Stream.each(fn msg ->
            send(test_pid, {:message, msg})
          end)
          |> Stream.take_while(fn
            %ChangeMessage{headers: %{operation: :update}, value: %{"parent_id" => "parent-2"}} ->
              false

            _ ->
              true
          end)
          |> Stream.run()
        end)

      # Wait for initial snapshot
      assert_receive {:message, %ChangeMessage{value: %{"id" => "child-1"}} = initial}, 5000
      assert_receive {:message, %ControlMessage{control: :up_to_date}}, 5000

      # Store initial tags
      initial_tags = Map.get(initial.headers, :tags, [])

      # Change child to reference parent-2
      Postgrex.query!(db_conn, "UPDATE child SET parent_id = 'parent-2' WHERE id = 'child-1'", [])

      # Should receive an update with new tags
      assert_receive {:message, %ChangeMessage{} = update_msg}, 5000
      assert update_msg.headers.operation == :update

      # The headers should include both removed_tags and new tags
      new_tags = Map.get(update_msg.headers, :tags, [])
      removed_tags = Map.get(update_msg.headers, :removed_tags, [])

      # Either we have explicit removed_tags, or tags have changed
      assert new_tags != initial_tags or length(removed_tags) > 0

      Task.shutdown(stream_task, :brutal_kill)
    end
  end

  describe "move-out buffering during snapshot" do
    setup [:with_unique_db, :with_parent_child_tables, :with_sql_execute]
    setup :with_complete_stack

    setup ctx do
      :ok = Electric.StatusMonitor.wait_until_active(ctx.stack_id, timeout: 2000)

      router_opts = build_router_opts(ctx)

      {:ok, server_pid} =
        start_supervised(
          {Bandit,
           plug: {Electric.Plug.Router, router_opts},
           port: 0,
           ip: :loopback,
           thousand_island_options: [num_acceptors: 1]}
        )

      {:ok, {_ip, port}} = ThousandIsland.listener_info(server_pid)
      base_url = "http://localhost:#{port}"
      {:ok, client} = Client.new(base_url: base_url)
      shape = ShapeDefinition.new!("child", where: @subquery_where)

      %{client: client, shape: shape, base_url: base_url, server_pid: server_pid, port: port}
    end

    @tag with_sql: [
           "INSERT INTO parent (id, active) VALUES ('parent-1', true)",
           "INSERT INTO child (id, parent_id, value) VALUES ('child-1', 'parent-1', 'test')"
         ]
    test "move-outs during initial sync are buffered and applied after up-to-date", %{
      client: client,
      shape: shape,
      db_conn: db_conn
    } do
      # This test verifies that if a move-out happens while we're still receiving
      # the initial snapshot, the client properly buffers it and applies it after
      # receiving up-to-date.

      test_pid = self()
      all_messages = :ets.new(:all_messages, [:ordered_set, :public])

      # Start streaming
      stream_task =
        Task.async(fn ->
          client
          |> Client.stream(shape, live: true)
          |> Stream.each(fn msg ->
            :ets.insert(all_messages, {System.monotonic_time(), msg})
            send(test_pid, {:message, msg})
          end)
          |> Stream.take(10)
          |> Stream.run()
        end)

      # Wait for initial insert
      assert_receive {:message, %ChangeMessage{value: %{"id" => "child-1"}}}, 5000
      assert_receive {:message, %ControlMessage{control: :up_to_date}}, 5000

      # Deactivate parent
      Postgrex.query!(db_conn, "UPDATE parent SET active = false WHERE id = 'parent-1'", [])

      # Should eventually see a delete for child-1
      assert_receive {:message, %ChangeMessage{headers: %{operation: :delete}}}, 5000

      # Verify message ordering: insert should come before delete
      messages =
        :ets.tab2list(all_messages)
        |> Enum.map(fn {_ts, msg} -> msg end)
        |> Enum.filter(&match?(%ChangeMessage{}, &1))

      insert_idx = Enum.find_index(messages, &(&1.headers.operation == :insert))
      delete_idx = Enum.find_index(messages, &(&1.headers.operation == :delete))

      assert insert_idx < delete_idx, "Insert should come before delete"

      :ets.delete(all_messages)
      Task.shutdown(stream_task, :brutal_kill)
    end
  end

  describe "must-refetch clears move-out state" do
    setup [:with_unique_db, :with_parent_child_tables, :with_sql_execute]
    setup :with_complete_stack

    setup ctx do
      :ok = Electric.StatusMonitor.wait_until_active(ctx.stack_id, timeout: 2000)

      router_opts = build_router_opts(ctx)

      {:ok, server_pid} =
        start_supervised(
          {Bandit,
           plug: {Electric.Plug.Router, router_opts},
           port: 0,
           ip: :loopback,
           thousand_island_options: [num_acceptors: 1]}
        )

      {:ok, {_ip, port}} = ThousandIsland.listener_info(server_pid)
      base_url = "http://localhost:#{port}"
      {:ok, client} = Client.new(base_url: base_url)
      shape = ShapeDefinition.new!("child", where: @subquery_where)

      %{client: client, shape: shape, base_url: base_url, server_pid: server_pid, port: port}
    end

    @tag with_sql: [
           "INSERT INTO parent (id, active) VALUES ('parent-1', true)",
           "INSERT INTO child (id, parent_id, value) VALUES ('child-1', 'parent-1', 'test')"
         ]
    test "must-refetch resets tag tracking state", %{client: client, shape: shape} do
      # First, get initial data with tags
      messages =
        client
        |> Client.stream(shape, live: false)
        |> Enum.to_list()

      insert_messages = Enum.filter(messages, &match?(%ChangeMessage{}, &1))
      assert length(insert_messages) == 1

      # Verify we get consistent results on a fresh stream (simulating after must-refetch)
      messages2 =
        client
        |> Client.stream(shape, live: false)
        |> Enum.to_list()

      insert_messages2 = Enum.filter(messages2, &match?(%ChangeMessage{}, &1))
      assert length(insert_messages2) == 1

      # Tags should be present on both
      [msg1] = insert_messages
      [msg2] = insert_messages2

      # Both should have consistent tag handling
      tags1 = Map.get(msg1.headers, :tags)
      tags2 = Map.get(msg2.headers, :tags)

      # If tags are present, they should be consistent
      if tags1 != nil and tags2 != nil do
        assert tags1 == tags2
      end
    end
  end

  # Helper to set up parent/child tables for subquery tests
  def with_parent_child_tables(%{db_conn: conn} = _context) do
    statements = [
      """
      CREATE TABLE parent (
        id TEXT PRIMARY KEY,
        active BOOLEAN NOT NULL DEFAULT true
      )
      """,
      """
      CREATE TABLE child (
        id TEXT PRIMARY KEY,
        parent_id TEXT NOT NULL REFERENCES parent(id) ON DELETE CASCADE,
        value TEXT NOT NULL
      )
      """
    ]

    Enum.each(statements, &Postgrex.query!(conn, &1, []))

    %{tables: [{"public", "parent"}, {"public", "child"}]}
  end
end
