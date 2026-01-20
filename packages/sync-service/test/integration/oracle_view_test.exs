defmodule Electric.Integration.OracleViewTest do
  @moduledoc """
  Differential tests that compare Electric shape streams to Postgres queries.
  """

  use ExUnit.Case, async: false

  import Support.ComponentSetup
  import Support.DbSetup
  import Support.IntegrationSetup
  import Support.OracleHarness

  @moduletag :tmp_dir

  setup [:with_unique_db]
  setup :with_complete_stack
  setup :with_electric_client

  @oracle_cases [
    %{
      name: "simple_subquery_move_in_out",
      schema_sql: [
        "DROP TABLE IF EXISTS child",
        "DROP TABLE IF EXISTS parent",
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
      ],
      seed_sql: [
        "INSERT INTO parent (id, active) VALUES ('parent-1', true), ('parent-2', false)",
        "INSERT INTO child (id, parent_id, value) VALUES ('child-1', 'parent-1', 'a'), ('child-2', 'parent-2', 'b')"
      ],
      shapes: [
        %{
          name: "active_children",
          table: "child",
          where: "parent_id IN (SELECT id FROM parent WHERE active = true)",
          columns: ["id", "parent_id", "value"],
          pk: ["id"],
          optimized: true
        }
      ],
      mutations: [
        %{
          name: "noop_parent_update",
          sql: "UPDATE parent SET active = false WHERE id = 'parent-2'"
        },
        %{
          name: "deactivate_parent",
          sql: "UPDATE parent SET active = false WHERE id = 'parent-1'"
        },
        %{
          name: "activate_parent",
          sql: "UPDATE parent SET active = true WHERE id = 'parent-2'"
        },
        %{
          name: "update_child_value",
          sql: "UPDATE child SET value = 'b2' WHERE id = 'child-2'"
        },
        %{
          name: "move_child_out",
          sql: "UPDATE child SET parent_id = 'parent-1' WHERE id = 'child-2'"
        }
      ]
    },
    %{
      name: "nested_subquery_of_subquery",
      schema_sql: [
        "DROP TABLE IF EXISTS tasks",
        "DROP TABLE IF EXISTS projects",
        "DROP TABLE IF EXISTS org_tags",
        "DROP TABLE IF EXISTS orgs",
        """
        CREATE TABLE orgs (
          id TEXT PRIMARY KEY,
          active BOOLEAN NOT NULL DEFAULT true
        )
        """,
        """
        CREATE TABLE org_tags (
          org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
          tag TEXT NOT NULL
        )
        """,
        """
        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE
        )
        """,
        """
        CREATE TABLE tasks (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          title TEXT NOT NULL
        )
        """
      ],
      seed_sql: [
        "INSERT INTO orgs (id, active) VALUES ('org-1', true), ('org-2', true)",
        "INSERT INTO org_tags (org_id, tag) VALUES ('org-1', 'alpha'), ('org-2', 'beta')",
        "INSERT INTO projects (id, org_id) VALUES ('proj-1', 'org-1'), ('proj-2', 'org-2')",
        "INSERT INTO tasks (id, project_id, title) VALUES ('task-1', 'proj-1', 't1'), ('task-2', 'proj-2', 't2')"
      ],
      shapes: [
        %{
          name: "alpha_tasks",
          table: "tasks",
          where:
            "project_id IN (SELECT id FROM projects WHERE org_id IN (SELECT id FROM orgs WHERE id IN (SELECT org_id FROM org_tags WHERE tag = 'alpha')))",
          columns: ["id", "project_id", "title"],
          pk: ["id"],
          optimized: false
        }
      ],
      mutations: [
        %{
          name: "toggle_unrelated_org",
          sql: "UPDATE orgs SET active = false WHERE id = 'org-2'"
        },
        %{
          name: "add_alpha_tag",
          sql: "INSERT INTO org_tags (org_id, tag) VALUES ('org-2', 'alpha')"
        },
        %{
          name: "remove_alpha_tag",
          sql: "DELETE FROM org_tags WHERE org_id = 'org-1' AND tag = 'alpha'"
        },
        %{
          name: "update_task_title",
          sql: "UPDATE tasks SET title = 't2b' WHERE id = 'task-2'"
        },
        %{
          name: "move_project_org",
          sql: "UPDATE projects SET org_id = 'org-1' WHERE id = 'proj-2'"
        }
      ]
    }
  ]

  test "Electric behaves like Postgres for oracle cases", ctx do
    run_cases(ctx, @oracle_cases)
  end
end
