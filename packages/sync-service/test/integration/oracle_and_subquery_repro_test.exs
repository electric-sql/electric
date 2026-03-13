defmodule Electric.Integration.OracleAndSubqueryReproTest do
  @moduledoc """
  Minimal reproduction for AND-of-two-subqueries bug.

  When a shape WHERE clause ANDs two subqueries on the same FK column with
  different filter values, the shape should always be empty (the conditions
  are mutually exclusive). But the server incorrectly sends updates for rows
  that partially match one subquery.

  Original failure from oracle property test (seed 8, SHAPE_COUNT=800):
    shape_28: (level_3_id IN (SELECT id FROM level_3 WHERE level_2_id = 'l2-4'))
          AND (level_3_id IN (SELECT id FROM level_3 WHERE level_2_id = 'l2-1'))
    Error: "update for row that does not exist: {\"l4-14\"}"
  """
  use ExUnit.Case, async: false

  import Support.ComponentSetup
  import Support.DbSetup
  import Support.DbStructureSetup
  import Support.IntegrationSetup
  import Support.OracleHarness

  @moduletag :oracle
  @moduletag timeout: :infinity
  @moduletag :tmp_dir

  setup [:with_unique_db, :with_sql_execute]
  setup :with_complete_stack

  setup ctx do
    with_electric_client(ctx, router_opts: [long_poll_timeout: 100])
  end

  @tag with_sql: [
         "CREATE TABLE parent (id TEXT PRIMARY KEY, group_id TEXT NOT NULL)",
         """
         CREATE TABLE child (
           id TEXT PRIMARY KEY,
           parent_id TEXT NOT NULL REFERENCES parent(id),
           value TEXT NOT NULL
         )
         """,
         "INSERT INTO parent (id, group_id) VALUES ('p1', 'g1'), ('p2', 'g2')",
         "INSERT INTO child (id, parent_id, value) VALUES ('c1', 'p1', 'v1')"
       ]
  test "AND of two mutually exclusive subqueries should remain empty", ctx do
    # No parent can have group_id = 'g1' AND group_id = 'g2' simultaneously.
    # The shape should always be empty regardless of mutations.
    shapes = [
      %{
        name: "always_empty",
        table: "child",
        where:
          "parent_id IN (SELECT id FROM parent WHERE group_id = 'g1') AND parent_id IN (SELECT id FROM parent WHERE group_id = 'g2')",
        columns: ["id", "parent_id", "value"],
        pk: ["id"],
        optimized: false
      }
    ]

    # Move c1 from p1 (g1) to p2 (g2). c1 now matches subquery 2 but not subquery 1.
    # The shape should remain empty, but the server sends an update for c1.
    batches = [
      [
        [
          %{name: "move_c1_to_p2", sql: "UPDATE child SET parent_id = 'p2' WHERE id = 'c1'"}
        ]
      ]
    ]

    test_against_oracle(ctx, shapes, batches)
  end
end
