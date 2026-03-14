defmodule Electric.Integration.OracleViewTest do
  @moduledoc """
  Hand-written oracle tests using the standard schema.

  These tests verify specific scenarios with explicit shapes and mutations
  to ensure coverage of important edge cases.

  Run with: mix test --include oracle
  """

  use ExUnit.Case, async: false

  import Support.ComponentSetup
  import Support.DbSetup
  import Support.IntegrationSetup
  import Support.OracleHarness
  import Support.OracleHarness.StandardSchema

  @moduletag :oracle
  @moduletag timeout: :infinity
  @moduletag :tmp_dir

  setup [:with_unique_db]
  setup :with_complete_stack
  setup :with_electric_client

  setup ctx do
    setup_standard_schema(ctx)
    :ok
  end

  describe "issues with same-key operations inside same transaction" do
    @describetag skip: "Same-transaction operations are not supported yet"
    test "materializer duplicate key on nested subquery reparenting", ctx do
      # Materializer invariant violation: insert for a key that already exists
      # or update for a key that doesn't exist. Triggered by nested subquery
      # shapes processing rapid parent-reparenting across multiple transactions.
      # A single batch of 4 transactions has ~50% trigger rate, so we repeat
      # the batch 20 times to make failure reliable (100% in testing).
      where_clauses = [
        # All 4 combinations of active flags on level_3 x level_2 nested subqueries
        "level_3_id IN (SELECT id FROM level_3 WHERE active = false AND level_2_id IN (SELECT id FROM level_2 WHERE active = true))",
        "level_3_id IN (SELECT id FROM level_3 WHERE active = true AND level_2_id IN (SELECT id FROM level_2 WHERE active = false))",
        "level_3_id IN (SELECT id FROM level_3 WHERE active = true AND level_2_id IN (SELECT id FROM level_2 WHERE active = true))",
        "level_3_id IN (SELECT id FROM level_3 WHERE active = false AND level_2_id IN (SELECT id FROM level_2 WHERE active = false))",
        # 3-level nested subqueries through level_1
        "level_3_id IN (SELECT id FROM level_3 WHERE level_2_id IN (SELECT id FROM level_2 WHERE level_1_id IN (SELECT id FROM level_1 WHERE active = true)))",
        "level_3_id IN (SELECT id FROM level_3 WHERE level_2_id IN (SELECT id FROM level_2 WHERE level_1_id IN (SELECT id FROM level_1 WHERE active = false)))"
      ]

      shapes =
        for {where, idx} <- Enum.with_index(where_clauses, 1) do
          %{
            name: "shape_#{idx}",
            table: "level_4",
            where: where,
            columns: ["id", "level_3_id", "value"],
            pk: ["id"],
            optimized: true
          }
        end

      # Build a single batch with 4 transactions
      txn_1 = [
        %{name: "m1", sql: "UPDATE level_3 SET level_2_id = 'l2-3' WHERE id = 'l3-4'"},
        %{name: "m2", sql: "UPDATE level_3 SET level_2_id = 'l2-2' WHERE id = 'l3-1'"},
        %{name: "m3", sql: "UPDATE level_3 SET level_2_id = 'l2-5' WHERE id = 'l3-5'"},
        %{name: "m4", sql: "UPDATE level_2 SET level_1_id = 'l1-2' WHERE id = 'l2-4'"},
        %{name: "m5", sql: "UPDATE level_2 SET active = NOT active WHERE id = 'l2-2'"},
        %{name: "m6", sql: "UPDATE level_1 SET active = NOT active WHERE id = 'l1-2'"},
        %{name: "m7", sql: "UPDATE level_3 SET level_2_id = 'l2-5' WHERE id = 'l3-1'"},
        %{name: "m8", sql: "UPDATE level_3 SET active = NOT active WHERE id = 'l3-5'"},
        %{name: "m9", sql: "UPDATE level_3 SET level_2_id = 'l2-2' WHERE id = 'l3-4'"},
        %{name: "m10", sql: "UPDATE level_2 SET active = NOT active WHERE id = 'l2-3'"},
        %{name: "m11", sql: "UPDATE level_3 SET level_2_id = 'l2-1' WHERE id = 'l3-3'"},
        %{name: "m12", sql: "UPDATE level_3 SET level_2_id = 'l2-3' WHERE id = 'l3-5'"},
        %{name: "m13", sql: "UPDATE level_2 SET level_1_id = 'l1-3' WHERE id = 'l2-2'"},
        %{name: "m14", sql: "UPDATE level_2 SET level_1_id = 'l1-1' WHERE id = 'l2-1'"}
      ]

      txn_2 = [
        %{name: "m15", sql: "UPDATE level_3 SET level_2_id = 'l2-4' WHERE id = 'l3-5'"},
        %{name: "m16", sql: "UPDATE level_3 SET active = NOT active WHERE id = 'l3-2'"},
        %{name: "m17", sql: "UPDATE level_1 SET active = NOT active WHERE id = 'l1-2'"},
        %{name: "m18", sql: "UPDATE level_2 SET level_1_id = 'l1-5' WHERE id = 'l2-5'"},
        %{name: "m19", sql: "UPDATE level_2 SET active = NOT active WHERE id = 'l2-1'"},
        %{name: "m20", sql: "UPDATE level_2 SET level_1_id = 'l1-2' WHERE id = 'l2-4'"},
        %{name: "m21", sql: "UPDATE level_3 SET level_2_id = 'l2-2' WHERE id = 'l3-2'"},
        %{name: "m22", sql: "UPDATE level_3 SET active = NOT active WHERE id = 'l3-5'"},
        %{name: "m23", sql: "UPDATE level_2 SET active = NOT active WHERE id = 'l2-1'"},
        %{name: "m24", sql: "UPDATE level_2 SET active = NOT active WHERE id = 'l2-1'"},
        %{name: "m25", sql: "UPDATE level_3 SET active = NOT active WHERE id = 'l3-1'"},
        %{name: "m26", sql: "UPDATE level_1 SET active = NOT active WHERE id = 'l1-5'"},
        %{name: "m27", sql: "UPDATE level_1 SET active = NOT active WHERE id = 'l1-3'"},
        %{name: "m28", sql: "UPDATE level_2 SET active = NOT active WHERE id = 'l2-4'"},
        %{name: "m29", sql: "UPDATE level_3 SET active = NOT active WHERE id = 'l3-2'"},
        %{name: "m30", sql: "UPDATE level_3 SET level_2_id = 'l2-3' WHERE id = 'l3-3'"}
      ]

      txn_3 = [
        %{name: "m31", sql: "UPDATE level_2 SET level_1_id = 'l1-3' WHERE id = 'l2-5'"},
        %{name: "m32", sql: "UPDATE level_2 SET level_1_id = 'l1-2' WHERE id = 'l2-4'"},
        %{name: "m33", sql: "UPDATE level_3 SET active = NOT active WHERE id = 'l3-2'"},
        %{name: "m34", sql: "UPDATE level_3 SET active = NOT active WHERE id = 'l3-5'"},
        %{name: "m35", sql: "UPDATE level_2 SET level_1_id = 'l1-2' WHERE id = 'l2-2'"},
        %{name: "m36", sql: "UPDATE level_2 SET level_1_id = 'l1-1' WHERE id = 'l2-2'"},
        %{name: "m37", sql: "UPDATE level_3 SET level_2_id = 'l2-2' WHERE id = 'l3-3'"},
        %{name: "m38", sql: "UPDATE level_3 SET active = NOT active WHERE id = 'l3-1'"},
        %{name: "m39", sql: "UPDATE level_3 SET level_2_id = 'l2-4' WHERE id = 'l3-3'"},
        %{name: "m40", sql: "UPDATE level_3 SET level_2_id = 'l2-1' WHERE id = 'l3-2'"},
        %{name: "m41", sql: "UPDATE level_3 SET active = NOT active WHERE id = 'l3-1'"},
        %{name: "m42", sql: "UPDATE level_3 SET level_2_id = 'l2-4' WHERE id = 'l3-2'"},
        %{name: "m43", sql: "UPDATE level_3 SET level_2_id = 'l2-2' WHERE id = 'l3-1'"},
        %{name: "m44", sql: "UPDATE level_3 SET active = NOT active WHERE id = 'l3-5'"},
        %{name: "m45", sql: "UPDATE level_2 SET level_1_id = 'l1-4' WHERE id = 'l2-4'"},
        %{name: "m46", sql: "UPDATE level_2 SET active = NOT active WHERE id = 'l2-4'"},
        %{name: "m47", sql: "UPDATE level_2 SET level_1_id = 'l1-1' WHERE id = 'l2-5'"},
        %{name: "m48", sql: "UPDATE level_3 SET level_2_id = 'l2-5' WHERE id = 'l3-4'"}
      ]

      # Each 4-txn batch has ~50% chance of triggering the materializer crash
      # (the race is between async query_move_in from one txn and WAL events
      # from the next). Repeating gives independent chances to trigger.
      batch = [txn_1, txn_2, txn_3]
      batches = List.duplicate(batch, 1)

      test_against_oracle(ctx, shapes, batches)
    end

    @tag with_sql: [
           # Custom schema: projects → teams → tasks
           "CREATE TABLE projects (id TEXT PRIMARY KEY)",
           "CREATE TABLE teams (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id))",
           "CREATE TABLE tasks (id TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES teams(id), title TEXT NOT NULL)",
           "INSERT INTO projects (id) VALUES ('proj_alpha'), ('proj_beta')",
           "INSERT INTO teams (id, project_id) VALUES ('team_a', 'proj_alpha'), ('team_b', 'proj_beta'), ('team_c', 'proj_beta')",
           "INSERT INTO tasks (id, team_id, title) VALUES ('task_1', 'team_a', 'Build feature')"
         ]
    test "stale row after task reassigned twice through intermediate team", ctx do
      # Shape: all tasks belonging to teams in proj_alpha
      shapes = [
        %{
          name: "tasks_in_proj_alpha",
          table: "tasks",
          where: "team_id IN (SELECT id FROM teams WHERE project_id = 'proj_alpha')",
          columns: ["id", "team_id", "title"],
          pk: ["id"],
          optimized: true
        }
      ]

      # In a single atomic transaction:
      #   1. Move team_b into proj_alpha (adds team_b to the dependency set)
      #   2. Reassign task_1 from team_a → team_b
      #   3. Reassign task_1 from team_b → team_c
      #
      # After commit: task_1 → team_c → proj_beta, so task_1 is NOT in shape.
      #
      # Bug:
      # team_a→team_b is delivered by the filter and processed, keeping task_1 in the shape view.
      # team_b→team_c is NOT delivered by the filter because neither team_b
      # nor team_c are in pre-txn refs. The move-in snapshot for team_b doesn't
      # find task_1 either (post-commit has team_id=team_c). Result: task_1
      # stuck in shape view with stale data.
      batches = [
        # Transaction 1
        [
          # Mutations for Transaction 1
          [
            %{
              name: "move_team_b_to_alpha",
              sql: "UPDATE teams SET project_id = 'proj_alpha' WHERE id = 'team_b'"
            },
            %{
              name: "reassign_task_1_to_team_b",
              sql: "UPDATE tasks SET team_id = 'team_b' WHERE id = 'task_1'"
            },
            %{
              name: "reassign_task_1_to_team_c",
              sql: "UPDATE tasks SET team_id = 'team_c' WHERE id = 'task_1'"
            }
          ]
        ]
      ]

      test_against_oracle(ctx, shapes, batches)
    end
  end
end
