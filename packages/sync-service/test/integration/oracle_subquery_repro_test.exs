defmodule Electric.Integration.OracleSubqueryReproTest do
  @moduledoc """
  Minimal reproduction for subquery move-in duplicate insert bug.

  When a single transaction both deactivates one parent (move-out) and
  activates another parent (move-in), and a child row changes its parent_id
  to the newly-activated parent, the move-in query returns the child row
  as an INSERT even though it was already in the shape — causing a duplicate.

  The bug requires:
  - A child row already in the shape (via parent p1)
  - Another child row NOT in the shape (via inactive parent p2)
  - A single transaction that:
    1. Deactivates p1 (triggers move-out)
    2. Activates p2 (triggers move-in query for children of p2)
    3. Changes c1's parent_id from p1 to p2

  The move-in query for p2 finds both c1 (just moved) and c2 (always had
  parent_id=p2). c1 is returned as an INSERT, but the client already has c1
  from the initial snapshot, causing "insert for row that already exists".
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
    ctx = with_electric_client(ctx, router_opts: [long_poll_timeout: 100])
    ctx
  end

  @tag with_sql: [
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
         """,
         "INSERT INTO parent (id, active) VALUES ('p1', true), ('p2', false)",
         "INSERT INTO child (id, parent_id, value) VALUES ('c1', 'p1', 'val1'), ('c2', 'p2', 'val2')"
       ]
  test "deactivate p1 + activate p2 + move child to p2 in same txn", ctx do
    shapes = [
      %{
        name: "child_shape",
        table: "child",
        where: "parent_id IN (SELECT id FROM parent WHERE active = true)",
        columns: ["id", "parent_id", "value"],
        pk: ["id"],
        optimized: false
      }
    ]

    # Initially: c1 is in shape (via p1), c2 is NOT (p2 inactive)
    # After txn: c1 stays in shape (now via p2), c2 joins shape (via p2)
    batches = [
      [
        [
          %{name: "deactivate_p1", sql: "UPDATE parent SET active = false WHERE id = 'p1'"},
          %{name: "activate_p2", sql: "UPDATE parent SET active = true WHERE id = 'p2'"},
          %{name: "move_c1_to_p2", sql: "UPDATE child SET parent_id = 'p2' WHERE id = 'c1'"}
        ]
      ]
    ]

    test_against_oracle(ctx, shapes, batches)
  end
end
