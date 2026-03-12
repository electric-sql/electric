defmodule Electric.Integration.OracleDnfReproTest do
  @moduledoc """
  Minimal reproduction for DNF subquery move-in bug.

  The WHERE clause `(A OR B) AND B` (where A is a literal IN, B is a subquery)
  simplifies logically to just B. But the DNF decomposition produces two disjuncts:

    d0 = [A, B]   — literal IN AND subquery
    d1 = [B]       — subquery only

  When a new value moves into B, rows matching only d1 (not d0) are missed.
  The move-in query incorrectly excludes rows that don't also satisfy A.

  Original failure from oracle property test:
    WHERE ((level_3_id IN ('l3-5', 'l3-1'))
           OR (level_3_id IN (SELECT id FROM level_3 WHERE active = false)))
      AND (level_3_id IN (SELECT id FROM level_3 WHERE active = false))

  Rows with level_3_id='l3-3' (matching B but not A) were missing from the
  materialized view after l3-3 became inactive.
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
         "CREATE TABLE parent (id TEXT PRIMARY KEY, active BOOLEAN NOT NULL DEFAULT true)",
         """
         CREATE TABLE child (
           id TEXT PRIMARY KEY,
           parent_id TEXT NOT NULL REFERENCES parent(id),
           value TEXT NOT NULL
         )
         """,
         # p1 and p2 start active, p3 starts inactive
         "INSERT INTO parent (id, active) VALUES ('p1', true), ('p2', true), ('p3', false)",
         # Children: c1->p1, c2->p2, c3->p3
         "INSERT INTO child (id, parent_id, value) VALUES ('c1', 'p1', 'v1'), ('c2', 'p2', 'v2'), ('c3', 'p3', 'v3')"
       ]
  test "DNF (A OR B) AND B: move-in includes rows matching B-only disjunct", ctx do
    # WHERE: (parent_id IN ('p1') OR parent_id IN (inactive parents)) AND parent_id IN (inactive parents)
    # Logically equivalent to: parent_id IN (inactive parents)
    #
    # Initial state: inactive parents = {p3}, so only c3 matches.
    # After toggling p2 to inactive: inactive = {p2, p3}, so c2 and c3 should match.
    #
    # The bug: c2 is missed because p2 is not in the literal IN ('p1'),
    # so d0=[A,B] doesn't match it, and d1=[B] move-in is broken.
    shapes = [
      %{
        name: "child_shape",
        table: "child",
        where:
          "(parent_id IN ('p1') OR parent_id IN (SELECT id FROM parent WHERE active = false)) AND parent_id IN (SELECT id FROM parent WHERE active = false)",
        columns: ["id", "parent_id", "value"],
        pk: ["id"],
        optimized: true
      }
    ]

    batches = [
      [
        [
          %{
            name: "deactivate_p2",
            sql: "UPDATE parent SET active = false WHERE id = 'p2'"
          }
        ]
      ]
    ]

    test_against_oracle(ctx, shapes, batches)
  end
end
