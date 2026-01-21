defmodule Electric.Integration.SubqueryDependencyUpdateTest do
  @moduledoc """
  BUG REPRODUCTION: Dependency tracking not updated when intermediate row moves.

  Scenario: A SaaS app where premium organizations get access to certain data.
  - Organizations can have a "premium" tag
  - Teams belong to organizations
  - Projects belong to teams
  - Tasks belong to projects

  Shape: "All tasks belonging to projects in teams under premium organizations"

  The bug: When a team moves from one premium org to another premium org,
  Electric doesn't update its internal tracking. Later, when the OLD org
  loses its premium tag, Electric incorrectly removes the tasks - even though
  they're now under a DIFFERENT org that still has premium.
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

  # Shape: tasks in projects in teams in premium organizations
  @premium_tasks_where """
  project_id IN (
    SELECT id FROM projects WHERE team_id IN (
      SELECT id FROM teams WHERE org_id IN (
        SELECT id FROM organizations WHERE id IN (
          SELECT org_id FROM organization_tags WHERE tag = 'premium'
        )
      )
    )
  )
  """

  describe "BUG: stale dependency tracking after intermediate row moves" do
    setup [:with_unique_db, :with_org_team_project_task_tables, :with_sql_execute]
    setup :with_complete_stack
    setup :with_electric_client

    @tag with_sql: [
           # Two organizations, both premium
           "INSERT INTO organizations (id, name) VALUES ('acme', 'Acme Corp'), ('globex', 'Globex Inc')",
           "INSERT INTO organization_tags (org_id, tag) VALUES ('acme', 'premium'), ('globex', 'premium')",
           # Engineering team belongs to Acme
           "INSERT INTO teams (id, name, org_id) VALUES ('engineering', 'Engineering', 'acme')",
           # Backend project belongs to Engineering team
           "INSERT INTO projects (id, name, team_id) VALUES ('backend', 'Backend API', 'engineering')",
           # A task in the Backend project
           "INSERT INTO tasks (id, title, project_id) VALUES ('task-1', 'Fix login bug', 'backend')"
         ]
    test "task deleted when old org loses tag, even though team moved", ctx do
      # SETUP:
      #   task-1 -> backend project -> engineering team -> acme org (PREMIUM)
      #
      # The shape includes task-1 because acme has the premium tag.

      shape = ShapeDefinition.new!("tasks", where: @premium_tasks_where)
      stream = Client.stream(ctx.client, shape, live: true)

      with_consumer stream do
        # Verify task-1 is in the shape initially
        assert_insert(consumer, %{"id" => "task-1", "title" => "Fix login bug"})
        assert_up_to_date(consumer)

        # MUTATION 1: Move engineering team from Acme to Globex
        # Both orgs have premium, so task-1 should STAY in the shape.
        # Path changes from: task-1 -> backend -> engineering -> acme (premium)
        #                to: task-1 -> backend -> engineering -> globex (premium)
        Postgrex.query!(
          ctx.db_conn,
          "UPDATE teams SET org_id = 'globex' WHERE id = 'engineering'",
          []
        )

        # Should NOT delete task-1 - it's still under a premium org
        messages_after_move = collect_messages(consumer, timeout: 1000)
        deletes_after_move = filter_deletes(messages_after_move)

        assert deletes_after_move == [],
               "Task should NOT be deleted when team moves to another premium org. " <>
                 "Got unexpected deletes: #{inspect(deletes_after_move)}"

        # MUTATION 2: Remove premium tag from Acme (the OLD org)
        # This should have NO EFFECT because:
        #   - Engineering team no longer belongs to Acme
        #   - task-1's path is now via Globex (which still has premium)
        Postgrex.query!(
          ctx.db_conn,
          "DELETE FROM organization_tags WHERE org_id = 'acme' AND tag = 'premium'",
          []
        )

        # BUG: Electric incorrectly deletes task-1 here!
        # It still thinks task-1 is connected to Acme.
        messages_after_tag_removal = collect_messages(consumer, timeout: 1000)
        deletes_after_tag_removal = filter_deletes(messages_after_tag_removal)

        assert deletes_after_tag_removal == [],
               """
               BUG REPRODUCED!

               Task was incorrectly deleted when Acme lost premium tag.
               But the task is now under Globex (which still has premium).

               Electric's dependency tracking wasn't updated when the team moved.

               Deleted: #{inspect(deletes_after_tag_removal)}
               """
      end
    end

    @tag with_sql: [
           # Four organizations: acme, globex, initech, umbrella - first 3 have premium
           "INSERT INTO organizations (id, name) VALUES ('acme', 'Acme'), ('globex', 'Globex'), ('initech', 'Initech'), ('umbrella', 'Umbrella')",
           "INSERT INTO organization_tags (org_id, tag) VALUES ('acme', 'premium'), ('globex', 'premium'), ('initech', 'premium')",
           # Teams under different orgs
           "INSERT INTO teams (id, name, org_id) VALUES ('team-a', 'Team A', 'acme'), ('team-b', 'Team B', 'globex'), ('team-c', 'Team C', 'initech'), ('team-d', 'Team D', 'umbrella')",
           # Projects under each team
           "INSERT INTO projects (id, name, team_id) VALUES ('proj-a', 'Project A', 'team-a'), ('proj-b', 'Project B', 'team-b'), ('proj-c', 'Project C', 'team-c'), ('proj-d', 'Project D', 'team-d')",
           # Tasks under each project
           "INSERT INTO tasks (id, title, project_id) VALUES ('task-a', 'Task A', 'proj-a'), ('task-b', 'Task B', 'proj-b'), ('task-c', 'Task C', 'proj-c'), ('task-d', 'Task D', 'proj-d')"
         ]
    test "multiple teams - same bug with more data", ctx do
      # SETUP:
      #   task-a -> proj-a -> team-a -> acme (PREMIUM)     ✓ in shape
      #   task-b -> proj-b -> team-b -> globex (PREMIUM)   ✓ in shape
      #   task-c -> proj-c -> team-c -> initech (PREMIUM)  ✓ in shape
      #   task-d -> proj-d -> team-d -> umbrella (no tag)  ✗ not in shape

      shape = ShapeDefinition.new!("tasks", where: @premium_tasks_where)
      stream = Client.stream(ctx.client, shape, live: true)

      with_consumer stream do
        # Initial: 3 tasks from premium orgs
        initial_ids = collect_initial_inserts(consumer, 3)
        assert Enum.sort(initial_ids) == ["task-a", "task-b", "task-c"]
        assert_up_to_date(consumer)

        # Move team-c from Initech to Globex (both premium - no visible change expected)
        Postgrex.query!(ctx.db_conn, "UPDATE teams SET org_id = 'globex' WHERE id = 'team-c'", [])

        messages1 = collect_messages(consumer, timeout: 1000)

        assert filter_deletes(messages1) == [],
               "No deletes expected when moving between premium orgs"

        # Remove premium from Initech (team-c's OLD org)
        # task-c should stay because it's now under Globex
        Postgrex.query!(
          ctx.db_conn,
          "DELETE FROM organization_tags WHERE org_id = 'initech' AND tag = 'premium'",
          []
        )

        messages2 = collect_messages(consumer, timeout: 1000)
        deletes = filter_deletes(messages2)

        assert deletes == [],
               """
               BUG REPRODUCED!

               task-c was deleted when Initech lost premium, but team-c is now under Globex!

               Deleted: #{inspect(deletes)}
               """
      end
    end
  end

  # ---- Helpers ----

  defp filter_deletes(messages) do
    messages
    |> Enum.filter(&match?(%ChangeMessage{headers: %{operation: :delete}}, &1))
    |> Enum.map(& &1.value)
  end

  defp collect_initial_inserts(consumer, expected_count) do
    {:ok, inserts} =
      await_count(consumer, expected_count,
        match: &match?(%ChangeMessage{headers: %{operation: :insert}}, &1)
      )

    Enum.map(inserts, & &1.value["id"])
  end

  # ---- Test Schema Setup ----

  def with_org_team_project_task_tables(%{db_conn: conn} = _context) do
    Postgrex.query!(
      conn,
      """
        CREATE TABLE organizations (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL
        )
      """,
      []
    )

    Postgrex.query!(
      conn,
      """
        CREATE TABLE organization_tags (
          org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          tag TEXT NOT NULL,
          PRIMARY KEY (org_id, tag)
        )
      """,
      []
    )

    Postgrex.query!(
      conn,
      """
        CREATE TABLE teams (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE
        )
      """,
      []
    )

    Postgrex.query!(
      conn,
      """
        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE
        )
      """,
      []
    )

    Postgrex.query!(
      conn,
      """
        CREATE TABLE tasks (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE
        )
      """,
      []
    )

    %{
      tables: [
        {"public", "organizations"},
        {"public", "organization_tags"},
        {"public", "teams"},
        {"public", "projects"},
        {"public", "tasks"}
      ]
    }
  end
end
