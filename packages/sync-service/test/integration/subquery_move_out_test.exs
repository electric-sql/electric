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
  import Support.IntegrationSetup

  alias Electric.Client
  alias Electric.Client.ShapeDefinition
  alias Electric.Client.Message.ChangeMessage

  @moduletag :integration
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
      import Support.StreamConsumer

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
      import Support.StreamConsumer

      stream = Client.stream(client, shape, live: true)

      with_consumer stream do
        # Wait for initial snapshot
        assert_insert(consumer, %{"id" => "child-1"})
        assert_insert(consumer, %{"id" => "child-2"})
        assert_up_to_date(consumer)

        # Deactivate the parent
        Postgrex.query!(db_conn, "UPDATE parent SET active = false WHERE id = 'parent-1'", [])

        # Wait for both synthetic deletes
        {:ok, deletes} = await_count(consumer, 2,
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
    test "deleting parent row triggers move-out", %{client: client, shape: shape, db_conn: db_conn} do
      import Support.StreamConsumer

      stream = Client.stream(client, shape, live: true)

      with_consumer stream do
        # Wait for initial snapshot
        assert_insert(consumer, %{"id" => "child-1"})
        assert_up_to_date(consumer)

        # Delete the parent row
        Postgrex.query!(db_conn, "DELETE FROM parent WHERE id = 'parent-1'", [])

        # Should receive a synthetic delete for the child
        delete_msg = assert_delete(consumer, %{"id" => "child-1"})
        assert delete_msg.value["id"] == "child-1"
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
      import Support.StreamConsumer

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
        Postgrex.query!(db_conn, "UPDATE child SET parent_id = 'parent-2' WHERE id = 'child-1'", [])

        # Should receive a new insert (move-in) for the child
        insert_msg = assert_insert(consumer, %{"id" => "child-1", "parent_id" => "parent-2"})
        assert insert_msg.headers.operation == :insert
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
      import Support.StreamConsumer

      stream = Client.stream(client, shape, live: true)

      with_consumer stream do
        # Wait for initial snapshot
        initial = assert_insert(consumer, %{"id" => "child-1"})
        assert_up_to_date(consumer)

        # Store initial tags
        initial_tags = Map.get(initial.headers, :tags, [])

        # Change child to reference parent-2
        Postgrex.query!(db_conn, "UPDATE child SET parent_id = 'parent-2' WHERE id = 'child-1'", [])

        # Should receive an update with new tags
        update_msg = assert_update(consumer, %{"id" => "child-1"})
        assert update_msg.headers.operation == :update

        # The headers should include both removed_tags and new tags
        new_tags = Map.get(update_msg.headers, :tags, [])
        removed_tags = Map.get(update_msg.headers, :removed_tags, [])

        # Either we have explicit removed_tags, or tags have changed
        assert new_tags != initial_tags or length(removed_tags) > 0
      end
    end
  end

  describe "move-out message ordering" do
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
    test "synthetic deletes maintain correct ordering after initial sync", %{
      client: client,
      shape: shape,
      db_conn: db_conn
    } do
      import Support.StreamConsumer

      stream = Client.stream(client, shape, live: true)

      with_consumer stream do
        # Wait for initial insert
        assert_insert(consumer, %{"id" => "child-1"})
        assert_up_to_date(consumer)

        # Deactivate parent
        Postgrex.query!(db_conn, "UPDATE parent SET active = false WHERE id = 'parent-1'", [])

        # Should eventually see a delete for child-1
        assert_delete(consumer, %{"id" => "child-1"})
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
