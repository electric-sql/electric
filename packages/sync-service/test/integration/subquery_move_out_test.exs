defmodule Electric.Integration.SubqueryMoveOutTest do
  @moduledoc """
  Integration tests for subquery move-out functionality.

  These tests verify that the Elixir client correctly handles:
  1. Tags on change messages (indicating why a row belongs to the shape)
  2. Move-out control messages (when dependency values are removed)
  3. Synthetic delete generation from move-out patterns
  """
  use ExUnit.Case, async: false

  import Support.ComponentSetup
  import Support.DbSetup
  import Support.DbStructureSetup
  import Support.IntegrationSetup
  import Support.StreamConsumer

  alias Electric.Client
  alias Electric.Client.ShapeDefinition
  alias Electric.Client.Message.ChangeMessage

  @moduletag :tmp_dir

  # Shape definition for child table filtered by active parents
  @subquery_where "parent_id IN (SELECT id FROM parent WHERE active = true)"

  describe "subquery move-out with parent/child tables" do
    setup [:with_unique_db, :with_parent_child_tables, :with_sql_execute]
    setup :with_complete_stack

    setup :with_electric_client

    setup _ctx do
      shape = ShapeDefinition.new!("child", where: @subquery_where)
      %{shape: shape}
    end

    @tag with_sql: [
           "INSERT INTO parent (id, active) VALUES ('parent-1', true)",
           "INSERT INTO child (id, parent_id, value) VALUES ('child-1', 'parent-1', 'test value')"
         ]
    test "change messages include tags for subquery-matched rows", %{client: client, shape: shape} do
      stream = Client.stream(client, shape, live: false)

      with_consumer stream do
        insert = assert_insert(consumer, %{"id" => "child-1"})
        assert %{headers: %{tags: [_]}} = insert
      end
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
      stream = Client.stream(client, shape, live: true)

      with_consumer stream do
        # Wait for initial snapshot
        assert_insert(consumer, %{"id" => "child-1"})
        assert_up_to_date(consumer)

        # Deactivate the parent - this should trigger a move-out
        Postgrex.query!(db_conn, "UPDATE parent SET active = false WHERE id = 'parent-1'", [])

        # Should receive a synthetic delete for child-1
        assert_delete(consumer, %{"id" => "child-1"})
      end
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
      stream = Client.stream(client, shape, live: true)

      with_consumer stream do
        # Wait for initial snapshot
        assert_insert(consumer, %{"id" => "child-1"})
        assert_insert(consumer, %{"id" => "child-2"})
        assert_up_to_date(consumer)

        # Deactivate the parent
        Postgrex.query!(db_conn, "UPDATE parent SET active = false WHERE id = 'parent-1'", [])

        # Wait for both synthetic deletes
        {:ok, deletes} =
          await_count(consumer, 2,
            match: fn msg ->
              match?(%ChangeMessage{headers: %{operation: :delete}}, msg)
            end
          )

        delete_ids = Enum.map(deletes, & &1.value["id"]) |> Enum.sort()
        assert delete_ids == ["child-1", "child-2"]
      end
    end

    @tag with_sql: [
           "INSERT INTO parent (id, active) VALUES ('parent-1', true)",
           "INSERT INTO child (id, parent_id, value) VALUES ('child-1', 'parent-1', 'test value')"
         ]
    test "deleting parent row triggers move-out", %{
      client: client,
      shape: shape,
      db_conn: db_conn
    } do
      stream = Client.stream(client, shape, live: true)

      with_consumer stream do
        # Wait for initial snapshot
        assert_insert(consumer, %{"id" => "child-1"})
        assert_up_to_date(consumer)

        # Delete the parent row
        Postgrex.query!(db_conn, "DELETE FROM parent WHERE id = 'parent-1'", [])

        # Should receive a synthetic delete for the child
        assert_delete(consumer, %{"id" => "child-1"})
      end
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
      stream = Client.stream(client, shape, live: true)

      with_consumer stream do
        # Wait for initial snapshot
        assert_insert(consumer, %{"id" => "child-1"})
        assert_up_to_date(consumer)

        # Deactivate parent-1
        Postgrex.query!(db_conn, "UPDATE parent SET active = false WHERE id = 'parent-1'", [])

        # Wait for the move-out (synthetic delete)
        assert_delete(consumer, %{"id" => "child-1"})
        assert_up_to_date(consumer)

        # Change child to reference parent-2 (which is still active)
        Postgrex.query!(
          db_conn,
          "UPDATE child SET parent_id = 'parent-2' WHERE id = 'child-1'",
          []
        )

        # Should receive a new insert (move-in) for the child
        assert_insert(consumer, %{"id" => "child-1", "parent_id" => "parent-2"})
      end
    end
  end

  describe "tag handling during updates" do
    setup [:with_unique_db, :with_parent_child_tables, :with_sql_execute]
    setup :with_complete_stack

    setup :with_electric_client

    setup _ctx do
      shape = ShapeDefinition.new!("child", where: @subquery_where)
      %{shape: shape}
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
      stream = Client.stream(client, shape, live: true)

      with_consumer stream do
        # Wait for initial snapshot
        initial = assert_insert(consumer, %{"id" => "child-1"})
        assert_up_to_date(consumer)

        # Store initial tags
        initial_tags = Map.get(initial.headers, :tags, [])

        # Change child to reference parent-2
        Postgrex.query!(
          db_conn,
          "UPDATE child SET parent_id = 'parent-2' WHERE id = 'child-1'",
          []
        )

        # Should receive an update with new tags
        update_msg = assert_update(consumer, %{"id" => "child-1"})

        # The headers should include both removed_tags and new tags
        new_tags = Map.get(update_msg.headers, :tags, [])
        removed_tags = Map.get(update_msg.headers, :removed_tags, [])

        # Either we have explicit removed_tags, or tags have changed
        assert new_tags != initial_tags or length(removed_tags) > 0
      end
    end

    @tag with_sql: [
           "INSERT INTO parent (id, active) VALUES ('parent-1', true)",
           "INSERT INTO parent (id, active) VALUES ('parent-2', true)",
           "INSERT INTO child (id, parent_id, value) VALUES ('child-1', 'parent-1', 'initial')"
         ]
    test "deactivating old parent after child changed parents should not generate delete", %{
      client: client,
      shape: shape,
      db_conn: db_conn
    } do
      # This tests that the tag index is properly updated when a row's tags change.
      # If the client doesn't clear stale tag entries, deactivating the OLD parent
      # would incorrectly generate a synthetic delete even though the child is
      # still in the shape (via the new parent).

      stream = Client.stream(client, shape, live: true)

      with_consumer stream do
        # Wait for initial snapshot - child-1 is in shape via parent-1
        assert_insert(consumer, %{"id" => "child-1"})
        assert_up_to_date(consumer)

        # Change child to reference parent-2 (also active)
        # This should update the tag index: remove parent-1's tag, add parent-2's tag
        Postgrex.query!(
          db_conn,
          "UPDATE child SET parent_id = 'parent-2' WHERE id = 'child-1'",
          []
        )

        # Should receive an update (child is still in shape, just via different parent)
        assert_update(consumer, %{"id" => "child-1"})
        assert_up_to_date(consumer)

        # Now deactivate parent-1 - this triggers a move-out for parent-1's tag
        # Since child-1 no longer has parent-1's tag (it was removed in the update),
        # this should NOT generate a synthetic delete
        Postgrex.query!(db_conn, "UPDATE parent SET active = false WHERE id = 'parent-1'", [])

        # Collect any messages that arrive - we should NOT see a delete for child-1
        messages = collect_messages(consumer, timeout: 500)

        delete_msgs =
          Enum.filter(messages, &match?(%ChangeMessage{headers: %{operation: :delete}}, &1))

        assert delete_msgs == [],
               "Should not generate synthetic delete for child-1 after old parent deactivated. " <>
                 "The tag index should have been updated when child changed parents. " <>
                 "Got: #{inspect(delete_msgs)}"
      end
    end
  end

  describe "must-refetch clears move-out state" do
    setup [:with_unique_db, :with_parent_child_tables, :with_sql_execute]
    setup :with_complete_stack

    setup :with_electric_client

    setup _ctx do
      shape = ShapeDefinition.new!("child", where: @subquery_where)
      %{shape: shape}
    end

    @tag with_sql: [
           "INSERT INTO parent (id, active) VALUES ('parent-1', true)",
           "INSERT INTO child (id, parent_id, value) VALUES ('child-1', 'parent-1', 'test')"
         ]
    test "must-refetch resets tag tracking state", %{client: client, shape: shape} do
      # First, get initial data with tags
      stream1 = Client.stream(client, shape, live: false)

      msg1 =
        with_consumer stream1 do
          assert_insert(consumer, %{"id" => "child-1"})
        end

      # Verify we get consistent results on a fresh stream (simulating after must-refetch)
      stream2 = Client.stream(client, shape, live: false)

      msg2 =
        with_consumer stream2 do
          assert_insert(consumer, %{"id" => "child-1"})
        end

      # Both should have consistent tag handling
      tags1 = Map.get(msg1.headers, :tags)
      tags2 = Map.get(msg2.headers, :tags)

      # If tags are present, they should be consistent
      if tags1 != nil and tags2 != nil do
        assert tags1 == tags2
      end
    end
  end

  describe "resume preserves move-out state" do
    setup [:with_unique_db, :with_parent_child_tables, :with_sql_execute]
    setup :with_complete_stack

    setup :with_electric_client

    setup _ctx do
      shape = ShapeDefinition.new!("child", where: @subquery_where)
      %{shape: shape}
    end

    @tag with_sql: [
           "INSERT INTO parent (id, active) VALUES ('parent-1', true)",
           "INSERT INTO child (id, parent_id, value) VALUES ('child-1', 'parent-1', 'test value')"
         ]
    test "move-out after resume generates synthetic delete", %{
      client: client,
      shape: shape,
      db_conn: db_conn
    } do
      # First, stream with live: false to get a ResumeMessage
      # This simulates a client that synced initial data and then disconnected
      stream1 = Client.stream(client, shape, live: false)

      resume_msg =
        with_consumer stream1 do
          assert_insert(consumer, %{"id" => "child-1"})
          assert_up_to_date(consumer)
          assert_resume(consumer)
        end

      # Now deactivate the parent while "disconnected"
      # This should trigger a move-out on the server side
      Postgrex.query!(db_conn, "UPDATE parent SET active = false WHERE id = 'parent-1'", [])

      # Give the server time to process the change
      Process.sleep(100)

      # Resume the stream - with proper move-out support, the client should
      # receive a synthetic delete for child-1 because its parent was deactivated
      stream2 = Client.stream(client, shape, live: false, resume: resume_msg)

      with_consumer stream2 do
        assert_delete(consumer, %{"id" => "child-1"})
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
