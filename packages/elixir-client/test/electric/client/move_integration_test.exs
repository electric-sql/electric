defmodule Electric.Client.MoveIntegrationTest do
  @moduledoc """
  Integration tests for move-in/out support in the Electric client.

  These tests use real Postgres and Electric server to verify:
  - Shapes with subquery WHERE clauses receive tagged rows
  - Move-out events are triggered when parent rows change
  - Move-in events bring new rows into the shape
  - Client correctly tracks tags and generates synthetic deletes
  """

  use ExUnit.Case, async: false

  import Support.ClientHelpers

  alias Electric.Client
  alias Electric.Client.Fetch
  alias Electric.Client.Message.{ChangeMessage, ControlMessage, EventMessage, Headers}
  alias Electric.Client.ShapeDefinition

  @moduletag :move_support

  # Helper to create tables for subquery testing
  defp with_parent_child_tables(_ctx) do
    base_config =
      Application.fetch_env!(:electric_client, :database_config)
      |> Electric.Utils.deobfuscate_password()

    extra_opts = [backoff_type: :stop, max_restarts: 0]
    {:ok, pool} = Postgrex.start_link(base_config ++ extra_opts)
    Process.unlink(pool)

    suffix = Electric.Client.Util.generate_id(6)
    parent_table = "parent_#{suffix}"
    child_table = "child_#{suffix}"

    # Create parent table
    Postgrex.query!(
      pool,
      """
      CREATE TABLE IF NOT EXISTS "#{parent_table}" (
        id INT PRIMARY KEY,
        value INT NOT NULL
      )
      """,
      []
    )

    # Create child table with foreign key
    Postgrex.query!(
      pool,
      """
      CREATE TABLE IF NOT EXISTS "#{child_table}" (
        id INT PRIMARY KEY,
        parent_id INT NOT NULL REFERENCES "#{parent_table}"(id),
        name TEXT NOT NULL
      )
      """,
      []
    )

    on_exit(fn ->
      Process.link(pool)
      Postgrex.query!(pool, ~s[DROP TABLE IF EXISTS "#{child_table}"], [])
      Postgrex.query!(pool, ~s[DROP TABLE IF EXISTS "#{parent_table}"], [])
      GenServer.stop(pool)
    end)

    %{
      pool: pool,
      db_conn: pool,
      parent_table: parent_table,
      child_table: child_table
    }
  end

  defp setup_client(_ctx) do
    {:ok, client} =
      Client.new(
        base_url: Application.fetch_env!(:electric_client, :electric_url),
        fetch:
          {Fetch.HTTP,
           [
             request: [
               retry_log_level: false,
               max_retries: 3,
               connect_options: [protocols: [:http1]]
             ]
           ]}
      )

    %{client: client}
  end

  defp insert_parent(ctx, id, value) do
    Postgrex.query!(ctx.db_conn, ~s[INSERT INTO "#{ctx.parent_table}" (id, value) VALUES ($1, $2)], [id, value])
  end

  defp insert_child(ctx, id, parent_id, name) do
    Postgrex.query!(
      ctx.db_conn,
      ~s[INSERT INTO "#{ctx.child_table}" (id, parent_id, name) VALUES ($1, $2, $3)],
      [id, parent_id, name]
    )
  end

  defp update_parent(ctx, id, value) do
    Postgrex.query!(ctx.db_conn, ~s[UPDATE "#{ctx.parent_table}" SET value = $1 WHERE id = $2], [value, id])
  end

  defp delete_parent(ctx, id) do
    # First delete children to satisfy FK constraint
    Postgrex.query!(ctx.db_conn, ~s[DELETE FROM "#{ctx.child_table}" WHERE parent_id = $1], [id])
    Postgrex.query!(ctx.db_conn, ~s[DELETE FROM "#{ctx.parent_table}" WHERE id = $1], [id])
  end

  describe "shapes with subqueries" do
    setup [:with_parent_child_tables, :setup_client]

    test "streams rows matching subquery with tags", ctx do
      # Insert parent rows
      insert_parent(ctx, 1, 1)
      insert_parent(ctx, 2, 2)

      # Insert child rows
      insert_child(ctx, 1, 1, "Child of parent 1")
      insert_child(ctx, 2, 2, "Child of parent 2")

      # Create shape with subquery - only children of parents with value = 1
      where = ~s[parent_id IN (SELECT id FROM "#{ctx.parent_table}" WHERE value = 1)]

      {:ok, shape} =
        ShapeDefinition.new(ctx.child_table, where: where, namespace: "public")

      on_exit(fn ->
        ExUnit.CaptureLog.capture_log(fn ->
          Client.delete_shape(ctx.client, shape)
        end)
      end)

      # Stream initial snapshot
      messages =
        Client.stream(ctx.client, shape, live: false)
        |> Enum.to_list()

      # Should get one child (id=1) and up-to-date
      change_msgs = Enum.filter(messages, &match?(%ChangeMessage{}, &1))
      assert length(change_msgs) == 1

      [child_msg] = change_msgs
      assert child_msg.value["id"] == 1
      assert child_msg.value["name"] == "Child of parent 1"
      assert child_msg.headers.operation == :insert

      # Tags should be present for subquery shapes
      assert is_list(child_msg.headers.tags)
    end

    test "receives move-out event when parent no longer matches", ctx do
      # Insert parent and child
      insert_parent(ctx, 1, 1)
      insert_child(ctx, 1, 1, "Child 1")

      # Create shape with subquery
      where = ~s[parent_id IN (SELECT id FROM "#{ctx.parent_table}" WHERE value = 1)]
      {:ok, shape} = ShapeDefinition.new(ctx.child_table, where: where, namespace: "public")

      on_exit(fn ->
        ExUnit.CaptureLog.capture_log(fn ->
          Client.delete_shape(ctx.client, shape)
        end)
      end)

      parent = self()

      # Start streaming in a task
      {:ok, task} =
        start_supervised(
          {Task,
           fn ->
             Client.stream(ctx.client, shape)
             |> Stream.each(&send(parent, {:msg, &1}))
             |> Stream.run()
           end},
          restart: :temporary
        )

      # Wait for initial snapshot
      assert_receive {:msg, %ChangeMessage{value: %{"id" => 1}}}, 5000
      assert_receive {:msg, %ControlMessage{control: :up_to_date}}, 5000

      # Update parent to no longer match the subquery condition
      update_parent(ctx, 1, 99)

      # Should receive a move-out event
      assert_receive {:msg, %EventMessage{event: :move_out, patterns: patterns}}, 5000
      assert is_list(patterns)
      assert length(patterns) > 0

      # Each pattern should have pos and value
      Enum.each(patterns, fn pattern ->
        assert Map.has_key?(pattern, :pos)
        assert Map.has_key?(pattern, :value)
      end)

      stop_supervised(task)
    end

    test "receives move-in when parent starts matching", ctx do
      # Insert parent with value that doesn't match
      insert_parent(ctx, 1, 99)
      insert_child(ctx, 1, 1, "Child 1")

      # Create shape - child won't be included initially
      where = ~s[parent_id IN (SELECT id FROM "#{ctx.parent_table}" WHERE value = 1)]
      {:ok, shape} = ShapeDefinition.new(ctx.child_table, where: where, namespace: "public")

      on_exit(fn ->
        ExUnit.CaptureLog.capture_log(fn ->
          Client.delete_shape(ctx.client, shape)
        end)
      end)

      parent = self()

      {:ok, task} =
        start_supervised(
          {Task,
           fn ->
             Client.stream(ctx.client, shape)
             |> Stream.each(&send(parent, {:msg, &1}))
             |> Stream.run()
           end},
          restart: :temporary
        )

      # Initial snapshot should be empty (just up-to-date)
      assert_receive {:msg, %ControlMessage{control: :up_to_date}}, 5000

      # Update parent to match the condition
      update_parent(ctx, 1, 1)

      # Should receive the child as a move-in (insert with is_move_in flag)
      assert_receive {:msg, %ChangeMessage{} = msg}, 5000
      assert msg.value["id"] == 1
      assert msg.value["name"] == "Child 1"
      assert msg.headers.operation == :insert

      stop_supervised(task)
    end

    test "move-out generates synthetic delete for row with single tag", ctx do
      # This test verifies the client-side move state tracking
      insert_parent(ctx, 1, 1)
      insert_child(ctx, 1, 1, "Child 1")

      where = ~s[parent_id IN (SELECT id FROM "#{ctx.parent_table}" WHERE value = 1)]
      {:ok, shape} = ShapeDefinition.new(ctx.child_table, where: where, namespace: "public")

      on_exit(fn ->
        ExUnit.CaptureLog.capture_log(fn ->
          Client.delete_shape(ctx.client, shape)
        end)
      end)

      parent = self()
      collected_msgs = :ets.new(:msgs, [:bag, :public])

      {:ok, task} =
        start_supervised(
          {Task,
           fn ->
             Client.stream(ctx.client, shape)
             |> Stream.each(fn msg ->
               :ets.insert(collected_msgs, {:msg, msg})
               send(parent, {:msg, msg})
             end)
             |> Stream.run()
           end},
          restart: :temporary
        )

      # Wait for initial data
      assert_receive {:msg, %ChangeMessage{value: %{"id" => 1}, headers: %{operation: :insert}}},
                     5000

      assert_receive {:msg, %ControlMessage{control: :up_to_date}}, 5000

      # Trigger move-out
      update_parent(ctx, 1, 99)

      # Wait for move-out event
      assert_receive {:msg, %EventMessage{event: :move_out}}, 5000

      # The stream should generate a synthetic delete
      # (this happens in the Stream module when processing move-out)
      assert_receive {:msg, %ChangeMessage{headers: %{operation: :delete}}}, 5000

      stop_supervised(task)
      :ets.delete(collected_msgs)
    end

    test "row with multiple tags survives partial move-out", ctx do
      # Create two parents that both match
      insert_parent(ctx, 1, 1)
      insert_parent(ctx, 2, 1)

      # Child references parent 1, but we'll create a shape where
      # it could theoretically have multiple reasons to be included
      insert_child(ctx, 1, 1, "Child 1")

      where = ~s[parent_id IN (SELECT id FROM "#{ctx.parent_table}" WHERE value = 1)]
      {:ok, shape} = ShapeDefinition.new(ctx.child_table, where: where, namespace: "public")

      on_exit(fn ->
        ExUnit.CaptureLog.capture_log(fn ->
          Client.delete_shape(ctx.client, shape)
        end)
      end)

      parent = self()

      {:ok, task} =
        start_supervised(
          {Task,
           fn ->
             Client.stream(ctx.client, shape)
             |> Stream.each(&send(parent, {:msg, &1}))
             |> Stream.run()
           end},
          restart: :temporary
        )

      # Wait for initial data
      assert_receive {:msg, %ChangeMessage{value: %{"id" => 1}}}, 5000
      assert_receive {:msg, %ControlMessage{control: :up_to_date}}, 5000

      # Change parent 2 - this shouldn't affect child 1 since it references parent 1
      update_parent(ctx, 2, 99)

      # We might get a move-out event, but no delete for child 1
      # Give it a moment to process
      Process.sleep(500)

      # The child should still be in the shape (no delete received)
      refute_receive {:msg, %ChangeMessage{value: %{"id" => 1}, headers: %{operation: :delete}}},
                     500

      stop_supervised(task)
    end
  end

  describe "multiple children affected by single move-out" do
    setup [:with_parent_child_tables, :setup_client]

    test "all children of moved-out parent receive synthetic deletes", ctx do
      # One parent with multiple children
      insert_parent(ctx, 1, 1)
      insert_child(ctx, 1, 1, "Child A")
      insert_child(ctx, 2, 1, "Child B")
      insert_child(ctx, 3, 1, "Child C")

      where = ~s[parent_id IN (SELECT id FROM "#{ctx.parent_table}" WHERE value = 1)]
      {:ok, shape} = ShapeDefinition.new(ctx.child_table, where: where, namespace: "public")

      on_exit(fn ->
        ExUnit.CaptureLog.capture_log(fn ->
          Client.delete_shape(ctx.client, shape)
        end)
      end)

      parent = self()

      {:ok, task} =
        start_supervised(
          {Task,
           fn ->
             Client.stream(ctx.client, shape)
             |> Stream.each(&send(parent, {:msg, &1}))
             |> Stream.run()
           end},
          restart: :temporary
        )

      # Wait for all three children
      assert_receive {:msg, %ChangeMessage{value: %{"name" => "Child A"}}}, 5000
      assert_receive {:msg, %ChangeMessage{value: %{"name" => "Child B"}}}, 5000
      assert_receive {:msg, %ChangeMessage{value: %{"name" => "Child C"}}}, 5000
      assert_receive {:msg, %ControlMessage{control: :up_to_date}}, 5000

      # Trigger move-out for parent
      update_parent(ctx, 1, 99)

      # Should receive move-out event
      assert_receive {:msg, %EventMessage{event: :move_out}}, 5000

      # Should receive synthetic deletes for all three children
      delete_ids =
        receive_all_deletes([], 3, 5000)
        |> Enum.map(& &1.key)

      assert length(delete_ids) == 3

      stop_supervised(task)
    end
  end

  # Helper to collect delete messages
  defp receive_all_deletes(acc, 0, _timeout), do: acc

  defp receive_all_deletes(acc, remaining, timeout) do
    receive do
      {:msg, %ChangeMessage{headers: %{operation: :delete}} = msg} ->
        receive_all_deletes([msg | acc], remaining - 1, timeout)

      {:msg, %ControlMessage{control: :up_to_date}} ->
        receive_all_deletes(acc, remaining, timeout)

      {:msg, _other} ->
        receive_all_deletes(acc, remaining, timeout)
    after
      timeout -> acc
    end
  end
end
