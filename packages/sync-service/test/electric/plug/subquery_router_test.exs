defmodule Electric.Plug.SubqueryRouterTest do
  @moduledoc """
  Integration tests for arbitrary boolean expressions with subqueries.

  These tests verify the RFC "Arbitrary Boolean Expressions with Subqueries":
  - OR with multiple subqueries
  - NOT with subqueries
  - Move-in/move-out with position-based handling
  - active_conditions in response headers
  - Multi-disjunct tag structures

  See: docs/rfcs/arbitrary-boolean-expressions-with-subqueries.md

  Tests tagged with @tag :dnf_subqueries require the RFC implementation to be complete.
  Run only those tests with: mix test --only dnf_subqueries
  Run without those tests with: mix test --exclude dnf_subqueries
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

  # Helper to set up the tables needed for subquery tests
  def with_subquery_tables(%{db_conn: conn} = _context) do
    statements = [
      """
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        active BOOLEAN NOT NULL DEFAULT true
      )
      """,
      """
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        admin BOOLEAN NOT NULL DEFAULT false
      )
      """,
      """
      CREATE TABLE archived_projects (
        id TEXT PRIMARY KEY
      )
      """,
      """
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        assigned_to TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        value TEXT
      )
      """
    ]

    Enum.each(statements, &Postgrex.query!(conn, &1, []))

    %{
      tables: [
        {"public", "projects"},
        {"public", "users"},
        {"public", "archived_projects"},
        {"public", "tasks"}
      ]
    }
  end

  describe "OR with subqueries - initial snapshot" do
    setup [:with_unique_db, :with_subquery_tables, :with_sql_execute]
    setup :with_complete_stack
    setup :with_electric_client

    @tag with_sql: [
           "INSERT INTO projects (id, active) VALUES ('p1', true)",
           "INSERT INTO users (id, admin) VALUES ('u1', true)",
           "INSERT INTO tasks (id, project_id, assigned_to) VALUES ('t1', 'p1', null)",
           "INSERT INTO tasks (id, project_id, assigned_to) VALUES ('t2', null, 'u1')",
           "INSERT INTO tasks (id, project_id, assigned_to) VALUES ('t3', 'p2', 'u2')"
         ]
    test "includes rows matching either condition", %{client: client} do
      # WHERE project_id IN (active projects) OR assigned_to IN (admin users)
      # t1 matches first condition (project p1 is active)
      # t2 matches second condition (user u1 is admin)
      # t3 matches neither (p2 doesn't exist/isn't active, u2 isn't admin)
      where =
        "project_id IN (SELECT id FROM projects WHERE active = true) OR " <>
          "assigned_to IN (SELECT id FROM users WHERE admin = true)"

      shape = ShapeDefinition.new!("tasks", where: where)
      stream = Client.stream(client, shape, live: false)

      with_consumer stream do
        # Should receive t1 and t2, but not t3
        msg1 = assert_insert(consumer, %{"id" => "t1"})
        msg2 = assert_insert(consumer, %{"id" => "t2"})
        assert_up_to_date(consumer)

        # Verify tags are present (structure depends on implementation)
        assert Map.has_key?(msg1.headers, :tags)
        assert Map.has_key?(msg2.headers, :tags)
      end
    end

    @tag with_sql: [
           "INSERT INTO projects (id, active) VALUES ('p1', true)",
           "INSERT INTO tasks (id, project_id) VALUES ('t1', 'p1')"
         ]
    test "includes active_conditions in response headers", %{client: client} do
      where = "project_id IN (SELECT id FROM projects WHERE active = true)"

      shape = ShapeDefinition.new!("tasks", where: where)
      stream = Client.stream(client, shape, live: false)

      with_consumer stream do
        msg = assert_insert(consumer, %{"id" => "t1"})
        assert_up_to_date(consumer)

        # active_conditions should be present when subqueries are involved
        # For a simple single-subquery case, this is [true] (one position, satisfied)
        assert Map.has_key?(msg.headers, :tags), "Expected tags in headers"
        assert Map.has_key?(msg.headers, :active_conditions), "Expected active_conditions in headers"
        assert msg.headers.active_conditions == [true], "Expected active_conditions to be [true] for satisfied condition"
      end
    end

    @tag with_sql: [
           "INSERT INTO projects (id, active) VALUES ('p1', true)",
           "INSERT INTO users (id, admin) VALUES ('u1', true)",
           "INSERT INTO tasks (id, project_id, assigned_to) VALUES ('t1', 'p1', 'u1')"
         ]
    test "row matching both disjuncts is included once with correct tags", %{client: client} do
      # t1 matches both conditions - should only appear once
      where =
        "project_id IN (SELECT id FROM projects WHERE active = true) OR " <>
          "assigned_to IN (SELECT id FROM users WHERE admin = true)"

      shape = ShapeDefinition.new!("tasks", where: where)
      stream = Client.stream(client, shape, live: false)

      with_consumer stream do
        msg = assert_insert(consumer, %{"id" => "t1"})
        assert_up_to_date(consumer)

        # Should have tags for both disjuncts
        assert Map.has_key?(msg.headers, :tags)
      end
    end
  end

  describe "OR with subqueries - move-in" do
    setup [:with_unique_db, :with_subquery_tables, :with_sql_execute]
    setup :with_complete_stack
    setup :with_electric_client

    @tag with_sql: [
           "INSERT INTO projects (id, active) VALUES ('p1', false)",
           "INSERT INTO tasks (id, project_id) VALUES ('t1', 'p1')"
         ]
    test "row moves in when subquery condition becomes true", %{client: client, db_conn: db_conn} do
      # Initially t1 is NOT in shape (p1 is not active)
      where = "project_id IN (SELECT id FROM projects WHERE active = true)"
      shape = ShapeDefinition.new!("tasks", where: where)
      stream = Client.stream(client, shape, live: true)

      with_consumer stream do
        # Initial snapshot should be empty (no tasks match)
        assert_up_to_date(consumer)

        # Activate the project - t1 should move in
        Postgrex.query!(db_conn, "UPDATE projects SET active = true WHERE id = 'p1'", [])

        # Should receive an insert for t1 (move-in)
        assert_insert(consumer, %{"id" => "t1"})
      end
    end

    @tag :dnf_subqueries
    @tag with_sql: [
           "INSERT INTO projects (id, active) VALUES ('p1', false)",
           "INSERT INTO users (id, admin) VALUES ('u1', true)",
           "INSERT INTO tasks (id, project_id, assigned_to) VALUES ('t1', 'p1', 'u1')"
         ]
    test "no duplicate insert when row already in shape for another disjunct", %{
      client: client,
      db_conn: db_conn
    } do
      # t1 is in shape because u1 is admin (second disjunct)
      # When p1 becomes active (first disjunct), we should NOT get a duplicate insert
      where =
        "project_id IN (SELECT id FROM projects WHERE active = true) OR " <>
          "assigned_to IN (SELECT id FROM users WHERE admin = true)"

      shape = ShapeDefinition.new!("tasks", where: where)
      stream = Client.stream(client, shape, live: true)

      with_consumer stream do
        # Initial: t1 is in shape via admin user
        assert_insert(consumer, %{"id" => "t1"})
        assert_up_to_date(consumer)

        # Activate the project
        Postgrex.query!(db_conn, "UPDATE projects SET active = true WHERE id = 'p1'", [])

        # Should receive a move-in control message, but NOT a duplicate insert for t1
        # The row is already present, so only active_conditions should change
        messages = collect_messages(consumer, timeout: 500)

        # Filter out control messages - we shouldn't see an insert for t1
        insert_msgs =
          Enum.filter(messages, fn
            %ChangeMessage{headers: %{operation: :insert}, value: %{"id" => "t1"}} -> true
            _ -> false
          end)

        assert insert_msgs == [],
               "Should not receive duplicate insert for row already in shape. Got: #{inspect(insert_msgs)}"
      end
    end
  end

  describe "OR with subqueries - move-out" do
    setup [:with_unique_db, :with_subquery_tables, :with_sql_execute]
    setup :with_complete_stack
    setup :with_electric_client

    @tag with_sql: [
           "INSERT INTO projects (id, active) VALUES ('p1', true)",
           "INSERT INTO tasks (id, project_id) VALUES ('t1', 'p1')"
         ]
    test "row moves out when only subquery condition becomes false", %{
      client: client,
      db_conn: db_conn
    } do
      where = "project_id IN (SELECT id FROM projects WHERE active = true)"
      shape = ShapeDefinition.new!("tasks", where: where)
      stream = Client.stream(client, shape, live: true)

      with_consumer stream do
        # Initial: t1 is in shape
        assert_insert(consumer, %{"id" => "t1"})
        assert_up_to_date(consumer)

        # Deactivate the project - t1 should move out
        Postgrex.query!(db_conn, "UPDATE projects SET active = false WHERE id = 'p1'", [])

        # Should receive a delete (synthetic from move-out)
        assert_delete(consumer, %{"id" => "t1"})
      end
    end

    @tag :dnf_subqueries
    @tag with_sql: [
           "INSERT INTO projects (id, active) VALUES ('p1', true)",
           "INSERT INTO users (id, admin) VALUES ('u1', true)",
           "INSERT INTO tasks (id, project_id, assigned_to) VALUES ('t1', 'p1', 'u1')"
         ]
    test "row stays when one disjunct deactivates but another is still satisfied", %{
      client: client,
      db_conn: db_conn
    } do
      # t1 matches both disjuncts
      where =
        "project_id IN (SELECT id FROM projects WHERE active = true) OR " <>
          "assigned_to IN (SELECT id FROM users WHERE admin = true)"

      shape = ShapeDefinition.new!("tasks", where: where)
      stream = Client.stream(client, shape, live: true)

      with_consumer stream do
        # Initial: t1 is in shape (matches both conditions)
        assert_insert(consumer, %{"id" => "t1"})
        assert_up_to_date(consumer)

        # Deactivate the project - but u1 is still admin, so t1 should stay
        Postgrex.query!(db_conn, "UPDATE projects SET active = false WHERE id = 'p1'", [])

        # Should NOT receive a delete for t1
        messages = collect_messages(consumer, timeout: 500)

        delete_msgs =
          Enum.filter(messages, fn
            %ChangeMessage{headers: %{operation: :delete}, value: %{"id" => "t1"}} -> true
            _ -> false
          end)

        assert delete_msgs == [],
               "Row should stay in shape when another disjunct is still satisfied. Got: #{inspect(delete_msgs)}"
      end
    end

    @tag :dnf_subqueries
    @tag with_sql: [
           "INSERT INTO projects (id, active) VALUES ('p1', true)",
           "INSERT INTO users (id, admin) VALUES ('u1', true)",
           "INSERT INTO tasks (id, project_id, assigned_to) VALUES ('t1', 'p1', 'u1')"
         ]
    test "row removed when all disjuncts become false", %{
      client: client,
      db_conn: db_conn
    } do
      where =
        "project_id IN (SELECT id FROM projects WHERE active = true) OR " <>
          "assigned_to IN (SELECT id FROM users WHERE admin = true)"

      shape = ShapeDefinition.new!("tasks", where: where)
      stream = Client.stream(client, shape, live: true)

      with_consumer stream do
        assert_insert(consumer, %{"id" => "t1"})
        assert_up_to_date(consumer)

        # Deactivate both conditions in a transaction
        Postgrex.transaction(db_conn, fn tx ->
          Postgrex.query!(tx, "UPDATE projects SET active = false WHERE id = 'p1'", [])
          Postgrex.query!(tx, "UPDATE users SET admin = false WHERE id = 'u1'", [])
        end)

        # Should receive a delete for t1
        # Use collect_messages since control messages may arrive before the delete
        messages = collect_messages(consumer, timeout: 1000)

        delete_msgs =
          Enum.filter(messages, fn
            %ChangeMessage{headers: %{operation: :delete}, value: %{"id" => "t1"}} -> true
            _ -> false
          end)

        assert length(delete_msgs) == 1,
               "Expected delete for t1 when all disjuncts become false. Got messages: #{inspect(messages)}"
      end
    end
  end

  describe "NOT with subqueries" do
    setup [:with_unique_db, :with_subquery_tables, :with_sql_execute]
    setup :with_complete_stack
    setup :with_electric_client

    @tag with_sql: [
           "INSERT INTO archived_projects (id) VALUES ('p1')",
           "INSERT INTO tasks (id, project_id) VALUES ('t1', 'p1')",
           "INSERT INTO tasks (id, project_id) VALUES ('t2', 'p2')"
         ]
    test "NOT IN excludes rows when value is in subquery", %{client: client} do
      # t1 has project_id 'p1' which IS in archived_projects -> excluded
      # t2 has project_id 'p2' which is NOT in archived_projects -> included
      where = "project_id NOT IN (SELECT id FROM archived_projects)"
      shape = ShapeDefinition.new!("tasks", where: where)
      stream = Client.stream(client, shape, live: false)

      with_consumer stream do
        # Should receive t2 only
        assert_insert(consumer, %{"id" => "t2"})
        assert_up_to_date(consumer)
      end
    end

    @tag :dnf_subqueries
    @tag with_sql: [
           "INSERT INTO tasks (id, project_id) VALUES ('t1', 'p1')",
           "INSERT INTO tasks (id, project_id) VALUES ('t2', 'p2')"
         ]
    test "move-in to NOT IN subquery triggers move-out", %{client: client, db_conn: db_conn} do
      # Initially both tasks are in shape (archived_projects is empty)
      where = "project_id NOT IN (SELECT id FROM archived_projects)"
      shape = ShapeDefinition.new!("tasks", where: where)
      stream = Client.stream(client, shape, live: true)

      with_consumer stream do
        assert_insert(consumer, %{"id" => "t1"})
        assert_insert(consumer, %{"id" => "t2"})
        assert_up_to_date(consumer)

        # Archive p1 - t1 should move out
        Postgrex.query!(db_conn, "INSERT INTO archived_projects (id) VALUES ('p1')", [])

        # t1 should be deleted (move-out because NOT IN now evaluates to false)
        assert_delete(consumer, %{"id" => "t1"})
      end
    end

    @tag :dnf_subqueries
    @tag with_sql: [
           "INSERT INTO archived_projects (id) VALUES ('p1')",
           "INSERT INTO tasks (id, project_id) VALUES ('t1', 'p1')"
         ]
    test "move-out from NOT IN subquery triggers move-in", %{client: client, db_conn: db_conn} do
      # Initially t1 is NOT in shape (p1 is archived)
      where = "project_id NOT IN (SELECT id FROM archived_projects)"
      shape = ShapeDefinition.new!("tasks", where: where)
      stream = Client.stream(client, shape, live: true)

      with_consumer stream do
        # Initial snapshot should be empty
        assert_up_to_date(consumer)

        # Unarchive p1 - t1 should move in
        Postgrex.query!(db_conn, "DELETE FROM archived_projects WHERE id = 'p1'", [])

        # t1 should be inserted (move-in because NOT IN now evaluates to true)
        assert_insert(consumer, %{"id" => "t1"})
      end
    end
  end

  describe "mixed conditions (subqueries + field filters)" do
    setup [:with_unique_db, :with_subquery_tables, :with_sql_execute]
    setup :with_complete_stack
    setup :with_electric_client

    @tag with_sql: [
           "INSERT INTO projects (id, active) VALUES ('p1', true)",
           "INSERT INTO tasks (id, project_id, status) VALUES ('t1', 'p1', 'open')",
           "INSERT INTO tasks (id, project_id, status) VALUES ('t2', 'p1', 'closed')",
           "INSERT INTO tasks (id, project_id, status) VALUES ('t3', 'p2', 'open')"
         ]
    test "AND of subquery and field condition", %{client: client} do
      # (project_id IN active projects) AND (status = 'open')
      # t1: project active AND status open -> included
      # t2: project active BUT status closed -> excluded
      # t3: project not active BUT status open -> excluded
      where =
        "project_id IN (SELECT id FROM projects WHERE active = true) AND status = 'open'"

      shape = ShapeDefinition.new!("tasks", where: where)
      stream = Client.stream(client, shape, live: false)

      with_consumer stream do
        assert_insert(consumer, %{"id" => "t1"})
        assert_up_to_date(consumer)
      end
    end

    @tag with_sql: [
           "INSERT INTO projects (id, active) VALUES ('p1', true)",
           "INSERT INTO users (id, admin) VALUES ('u1', true)",
           "INSERT INTO tasks (id, project_id, assigned_to, status) VALUES ('t1', 'p1', null, 'open')",
           "INSERT INTO tasks (id, project_id, assigned_to, status) VALUES ('t2', null, 'u1', 'open')",
           "INSERT INTO tasks (id, project_id, assigned_to, status) VALUES ('t3', 'p2', 'u2', 'open')"
         ]
    test "OR of (subquery AND field) combinations", %{client: client} do
      # (project_id IN active AND status = 'open') OR (assigned_to IN admins)
      # This is the DNF example from the RFC
      where =
        "(project_id IN (SELECT id FROM projects WHERE active = true) AND status = 'open') OR " <>
          "assigned_to IN (SELECT id FROM users WHERE admin = true)"

      shape = ShapeDefinition.new!("tasks", where: where)
      stream = Client.stream(client, shape, live: false)

      with_consumer stream do
        # t1 matches first disjunct
        # t2 matches second disjunct
        # t3 matches neither
        assert_insert(consumer, %{"id" => "t1"})
        assert_insert(consumer, %{"id" => "t2"})
        assert_up_to_date(consumer)
      end
    end
  end

  describe "complex boolean expressions (De Morgan)" do
    setup [:with_unique_db, :with_subquery_tables, :with_sql_execute]
    setup :with_complete_stack
    setup :with_electric_client

    @tag with_sql: [
           "INSERT INTO projects (id, active) VALUES ('p1', true)",
           "INSERT INTO tasks (id, project_id, status) VALUES ('t1', 'p1', 'open')",
           "INSERT INTO tasks (id, project_id, status) VALUES ('t2', 'p1', 'closed')",
           "INSERT INTO tasks (id, project_id, status) VALUES ('t3', 'p2', 'open')"
         ]
    test "NOT (A AND B) - De Morgan distributes to (NOT A) OR (NOT B)", %{client: client} do
      # NOT (project_id IN active AND status = 'open')
      # Equivalent to: project_id NOT IN active OR status != 'open'
      # t1: p1 active AND open -> NOT (true AND true) = false -> excluded
      # t2: p1 active AND closed -> NOT (true AND false) = true -> included
      # t3: p2 not active AND open -> NOT (false AND true) = true -> included
      where =
        "NOT (project_id IN (SELECT id FROM projects WHERE active = true) AND status = 'open')"

      shape = ShapeDefinition.new!("tasks", where: where)
      stream = Client.stream(client, shape, live: false)

      with_consumer stream do
        assert_insert(consumer, %{"id" => "t2"})
        assert_insert(consumer, %{"id" => "t3"})
        assert_up_to_date(consumer)
      end
    end

    @tag with_sql: [
           "INSERT INTO projects (id, active) VALUES ('p1', true)",
           "INSERT INTO users (id, admin) VALUES ('u1', true)",
           "INSERT INTO tasks (id, project_id, assigned_to) VALUES ('t1', 'p1', 'u1')",
           "INSERT INTO tasks (id, project_id, assigned_to) VALUES ('t2', 'p1', 'u2')",
           "INSERT INTO tasks (id, project_id, assigned_to) VALUES ('t3', 'p2', 'u1')",
           "INSERT INTO tasks (id, project_id, assigned_to) VALUES ('t4', 'p2', 'u2')"
         ]
    test "NOT (A OR B) - De Morgan distributes to (NOT A) AND (NOT B)", %{client: client} do
      # NOT (project_id IN active OR assigned_to IN admins)
      # Equivalent to: project_id NOT IN active AND assigned_to NOT IN admins
      # t1: p1 active, u1 admin -> NOT (true OR true) = false -> excluded
      # t2: p1 active, u2 not admin -> NOT (true OR false) = false -> excluded
      # t3: p2 not active, u1 admin -> NOT (false OR true) = false -> excluded
      # t4: p2 not active, u2 not admin -> NOT (false OR false) = true -> included
      where =
        "NOT (project_id IN (SELECT id FROM projects WHERE active = true) OR " <>
          "assigned_to IN (SELECT id FROM users WHERE admin = true))"

      shape = ShapeDefinition.new!("tasks", where: where)
      stream = Client.stream(client, shape, live: false)

      with_consumer stream do
        assert_insert(consumer, %{"id" => "t4"})
        assert_up_to_date(consumer)
      end
    end
  end

  describe "edge cases" do
    setup [:with_unique_db, :with_subquery_tables, :with_sql_execute]
    setup :with_complete_stack
    setup :with_electric_client

    @tag with_sql: [
           "INSERT INTO tasks (id, project_id) VALUES ('t1', null)",
           "INSERT INTO tasks (id, project_id) VALUES ('t2', 'p1')"
         ]
    test "NULL values in subquery column - IN evaluates to NULL/false", %{client: client} do
      # NULL IN (...) evaluates to NULL which is falsy
      where = "project_id IN (SELECT id FROM projects WHERE active = true)"
      shape = ShapeDefinition.new!("tasks", where: where)
      stream = Client.stream(client, shape, live: false)

      with_consumer stream do
        # Neither task matches - t1 has NULL project_id, t2's p1 doesn't exist
        assert_up_to_date(consumer)
      end
    end

    @tag with_sql: [
           "INSERT INTO tasks (id, project_id) VALUES ('t1', 'p1')"
         ]
    test "empty subquery - IN empty is false, NOT IN empty is true", %{client: client} do
      # archived_projects is empty, so NOT IN should return true
      where = "project_id NOT IN (SELECT id FROM archived_projects)"
      shape = ShapeDefinition.new!("tasks", where: where)
      stream = Client.stream(client, shape, live: false)

      with_consumer stream do
        # t1 should be included (NOT IN empty set = true)
        assert_insert(consumer, %{"id" => "t1"})
        assert_up_to_date(consumer)
      end
    end

    @tag with_sql: [
           "INSERT INTO projects (id, active) VALUES ('p1', true)",
           "INSERT INTO projects (id, active) VALUES ('p2', true)",
           "INSERT INTO tasks (id, project_id, assigned_to) VALUES ('t1', 'p1', null)"
         ]
    test "update changing parent reference updates tags", %{client: client, db_conn: db_conn} do
      where = "project_id IN (SELECT id FROM projects WHERE active = true)"
      shape = ShapeDefinition.new!("tasks", where: where)
      stream = Client.stream(client, shape, live: true)

      with_consumer stream do
        initial_msg = assert_insert(consumer, %{"id" => "t1"})
        assert_up_to_date(consumer)

        # Store initial tags
        initial_tags = Map.get(initial_msg.headers, :tags)

        # Change t1's reference to p2 (both are active, so row stays in shape)
        Postgrex.query!(db_conn, "UPDATE tasks SET project_id = 'p2' WHERE id = 't1'", [])

        # Should receive an update with potentially different tags
        update_msg = assert_update(consumer, %{"id" => "t1"})

        new_tags = Map.get(update_msg.headers, :tags)
        removed_tags = Map.get(update_msg.headers, :removed_tags)

        # Either tags changed or removed_tags is present
        assert new_tags != initial_tags or removed_tags != nil
      end
    end

    @tag :dnf_subqueries
    @tag with_sql: [
           "INSERT INTO projects (id, active) VALUES ('p1', true)",
           "INSERT INTO projects (id, active) VALUES ('p2', true)",
           "INSERT INTO tasks (id, project_id) VALUES ('t1', 'p1')"
         ]
    test "deactivating old parent after child changed parents doesn't delete", %{
      client: client,
      db_conn: db_conn
    } do
      where = "project_id IN (SELECT id FROM projects WHERE active = true)"
      shape = ShapeDefinition.new!("tasks", where: where)
      stream = Client.stream(client, shape, live: true)

      with_consumer stream do
        assert_insert(consumer, %{"id" => "t1"})
        assert_up_to_date(consumer)

        # Change t1 to reference p2
        Postgrex.query!(db_conn, "UPDATE tasks SET project_id = 'p2' WHERE id = 't1'", [])
        assert_update(consumer, %{"id" => "t1"})
        assert_up_to_date(consumer)

        # Deactivate p1 - t1 should NOT be deleted (it's now on p2)
        Postgrex.query!(db_conn, "UPDATE projects SET active = false WHERE id = 'p1'", [])

        # Collect messages - should not see a delete
        messages = collect_messages(consumer, timeout: 500)

        delete_msgs =
          Enum.filter(messages, fn
            %ChangeMessage{headers: %{operation: :delete}} -> true
            _ -> false
          end)

        assert delete_msgs == [],
               "Should not delete row after old parent deactivated. Got: #{inspect(delete_msgs)}"
      end
    end
  end

  describe "resume preserves state" do
    setup [:with_unique_db, :with_subquery_tables, :with_sql_execute]
    setup :with_complete_stack
    setup :with_electric_client

    @tag with_sql: [
           "INSERT INTO projects (id, active) VALUES ('p1', true)",
           "INSERT INTO tasks (id, project_id) VALUES ('t1', 'p1')"
         ]
    test "move-out after resume generates synthetic delete", %{
      client: client,
      db_conn: db_conn
    } do
      where = "project_id IN (SELECT id FROM projects WHERE active = true)"
      shape = ShapeDefinition.new!("tasks", where: where)

      # First stream - get initial data and resume point
      stream1 = Client.stream(client, shape, live: false)

      resume_msg =
        with_consumer stream1 do
          assert_insert(consumer, %{"id" => "t1"})
          assert_up_to_date(consumer)
          assert_resume(consumer)
        end

      # Deactivate project while "disconnected"
      Postgrex.query!(db_conn, "UPDATE projects SET active = false WHERE id = 'p1'", [])

      # Resume the stream
      stream2 = Client.stream(client, shape, live: false, resume: resume_msg)

      with_consumer stream2 do
        # Should receive delete for t1 (move-out happened while disconnected)
        assert_delete(consumer, %{"id" => "t1"})
      end
    end
  end

  describe "tag consistency" do
    setup [:with_unique_db, :with_subquery_tables, :with_sql_execute]
    setup :with_complete_stack
    setup :with_electric_client

    @tag with_sql: [
           "INSERT INTO projects (id, active) VALUES ('p1', true)",
           "INSERT INTO tasks (id, project_id) VALUES ('t1', 'p1')"
         ]
    test "fresh streams have consistent tags", %{client: client} do
      where = "project_id IN (SELECT id FROM projects WHERE active = true)"
      shape = ShapeDefinition.new!("tasks", where: where)

      # Get tags from first stream
      stream1 = Client.stream(client, shape, live: false)

      msg1 =
        with_consumer stream1 do
          assert_insert(consumer, %{"id" => "t1"})
        end

      # Get tags from second fresh stream
      stream2 = Client.stream(client, shape, live: false)

      msg2 =
        with_consumer stream2 do
          assert_insert(consumer, %{"id" => "t1"})
        end

      # Tags should be consistent
      tags1 = Map.get(msg1.headers, :tags)
      tags2 = Map.get(msg2.headers, :tags)

      assert tags1 == tags2,
             "Tags should be consistent across fresh streams. Got #{inspect(tags1)} vs #{inspect(tags2)}"
    end
  end
end
