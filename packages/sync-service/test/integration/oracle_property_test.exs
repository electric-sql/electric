defmodule Electric.Integration.OraclePropertyTest do
  @moduledoc """
  Property tests that generate oracle cases with bounded runtime.
  """

  use ExUnit.Case, async: false
  use ExUnitProperties

  import Support.ComponentSetup
  import Support.DbSetup
  import Support.IntegrationSetup
  import Support.OracleHarness

  @moduletag :tmp_dir

  setup [:with_unique_db]
  setup :with_complete_stack
  setup :with_electric_client

  @org_ids ["org-1", "org-2", "org-3"]
  @project_ids ["proj-1", "proj-2", "proj-3"]
  @task_ids ["task-1", "task-2", "task-3", "task-4"]
  @tags ["alpha", "beta", "gamma"]

  @schema_sql [
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
  ]

  @seed_sql [
    "INSERT INTO orgs (id, active) VALUES ('org-1', true), ('org-2', true), ('org-3', false)",
    "INSERT INTO org_tags (org_id, tag) VALUES ('org-1', 'alpha'), ('org-2', 'beta')",
    "INSERT INTO projects (id, org_id) VALUES ('proj-1', 'org-1'), ('proj-2', 'org-2'), ('proj-3', 'org-3')",
    "INSERT INTO tasks (id, project_id, title) VALUES ('task-1', 'proj-1', 't1'), ('task-2', 'proj-2', 't2'), ('task-3', 'proj-3', 't3'), ('task-4', 'proj-1', 't4')"
  ]

  test "property oracle cases (bounded)", ctx do
    max_runs = env_int("ELECTRIC_ORACLE_PROP_RUNS") || 5

    check all case_spec <- oracle_case_gen(),
              max_runs: max_runs do
      run_cases(ctx, [case_spec])
    end
  end

  defp oracle_case_gen do
    import StreamData

    bind({where_gen(), list_of(mutation_gen(), min_length: 1, max_length: 4), integer(1..1_000_000)}, fn {where_spec, mutations, case_id} ->
      {where_clause, optimized?} = where_spec

      case_name = "prop_#{case_id}"

      mutations =
        mutations
        |> Enum.with_index(1)
        |> Enum.map(fn {mutation, index} ->
          %{name: "#{mutation_name(mutation)}_#{index}", sql: mutation_sql(mutation)}
        end)

      constant(%{
        name: case_name,
        schema_sql: @schema_sql,
        seed_sql: @seed_sql,
        shapes: [
          %{
            name: "tasks_shape",
            table: "tasks",
            where: where_clause,
            columns: ["id", "project_id", "title"],
            pk: ["id"],
            optimized: optimized?
          }
        ],
        mutations: mutations
      })
    end)
  end

  defp where_gen do
    import StreamData

    simple =
      member_of([
        {"title LIKE 't%'", true},
        {"title = 't1'", true},
        {"project_id = 'proj-1'", true}
      ])

    nested =
      bind({member_of(@tags), member_of(@org_ids)}, fn {tag, org_id} ->
        member_of([
          {
            "project_id IN (SELECT id FROM projects WHERE org_id IN (SELECT id FROM orgs WHERE active = true))",
            false
          },
          {
            "project_id IN (SELECT id FROM projects WHERE org_id IN (SELECT id FROM orgs WHERE id IN (SELECT org_id FROM org_tags WHERE tag = '#{tag}')))",
            false
          },
          {
            "project_id IN (SELECT id FROM projects WHERE org_id IN (SELECT id FROM orgs WHERE id IN (SELECT org_id FROM org_tags WHERE tag IN (SELECT tag FROM org_tags WHERE org_id = '#{org_id}'))))",
            false
          }
        ])
      end)

    one_of([simple, nested])
  end

  defp mutation_gen do
    import StreamData

    one_of([
      map(member_of(@org_ids), fn org_id -> {:toggle_org, org_id} end),
      map({member_of(@org_ids), member_of(@tags)}, fn {org_id, tag} ->
        {:add_tag, org_id, tag}
      end),
      map({member_of(@org_ids), member_of(@tags)}, fn {org_id, tag} ->
        {:remove_tag, org_id, tag}
      end),
      map({member_of(@project_ids), member_of(@org_ids)}, fn {project_id, org_id} ->
        {:move_project, project_id, org_id}
      end),
      map({member_of(@task_ids), member_of(@project_ids)}, fn {task_id, project_id} ->
        {:move_task, task_id, project_id}
      end),
      map(member_of(@task_ids), fn task_id -> {:update_task_title, task_id} end)
    ])
  end

  defp mutation_name({:toggle_org, _}), do: "toggle_org"
  defp mutation_name({:add_tag, _, _}), do: "add_tag"
  defp mutation_name({:remove_tag, _, _}), do: "remove_tag"
  defp mutation_name({:move_project, _, _}), do: "move_project"
  defp mutation_name({:move_task, _, _}), do: "move_task"
  defp mutation_name({:update_task_title, _}), do: "update_task_title"

  defp mutation_sql({:toggle_org, org_id}) do
    "UPDATE orgs SET active = NOT active WHERE id = '#{org_id}'"
  end

  defp mutation_sql({:add_tag, org_id, tag}) do
    "INSERT INTO org_tags (org_id, tag) VALUES ('#{org_id}', '#{tag}')"
  end

  defp mutation_sql({:remove_tag, org_id, tag}) do
    "DELETE FROM org_tags WHERE org_id = '#{org_id}' AND tag = '#{tag}'"
  end

  defp mutation_sql({:move_project, project_id, org_id}) do
    "UPDATE projects SET org_id = '#{org_id}' WHERE id = '#{project_id}'"
  end

  defp mutation_sql({:move_task, task_id, project_id}) do
    "UPDATE tasks SET project_id = '#{project_id}' WHERE id = '#{task_id}'"
  end

  defp mutation_sql({:update_task_title, task_id}) do
    "UPDATE tasks SET title = 't#{task_id}-x' WHERE id = '#{task_id}'"
  end

  defp env_int(name) do
    case System.get_env(name) do
      nil -> nil
      value -> String.to_integer(value)
    end
  end
end
