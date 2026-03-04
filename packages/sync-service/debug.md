
## Creating Minimal Repro Tests from Oracle Property Test Failures

When the oracle property test fails, it's usually with hundreds of shapes and mutations, making it hard to debug. The goal is to extract a minimal `test_against_oracle` call with simple tables and a handful of mutations.

### Step 1: Read the error output

The assertion error tells you which shape failed and what happened:
```
shape=shape_11: insert for row that already exists: {"l4-5"}
```

The error log above it shows the transaction fragment that was being processed when the crash occurred. Look for:
- Which rows changed (`UpdatedRecord`, `NewRecord`, `DeletedRecord`)
- Which columns changed (`changed_columns`)
- Parent table changes (e.g., `level_3.active` toggled) that trigger move-in/move-out
- Child FK changes (e.g., `level_4.level_3_id` changed) — these are sublink changes


You may also need to add IO.puts logging to the server and client code to understand the flow of tags and move-in/move-out patterns.

For the Client-side (`packages/elixir-client`):

| Location | What to Log |
|----------|-------------|
| `tag_tracker.ex:update_tag_index` (when tags non-empty) | `key`, `headers.operation`, `new_tags`, `removed_tags` |
| `tag_tracker.ex:generate_synthetic_deletes` | `patterns`, `Map.keys(tag_to_keys)`, `Map.keys(key_data)`, generated delete keys |
| `poll.ex:handle_message(MoveOutMessage)` | `state.shape_handle`, `patterns`, `length(synthetic_deletes)` |


### Step 2: Identify the bug pattern

Common patterns from the error output:
- **"insert for row that already exists"** → duplicate INSERT, likely move-in returning a row already in the shape
- **View mismatch (extra rows)** → missing synthetic delete, move-out not working
- **View mismatch (missing rows)** → row incorrectly filtered out or deleted

Look at what happened in the transaction to infer causation:
- Did a parent row's filter column change (e.g., `active` toggled)? → move-in or move-out triggered
- Did a child row's FK column change? → sublink change, interacts with move-in/move-out logic
- Did both happen in the same transaction? → concurrent move-in + WAL change interaction

### Step 3: Build the minimal test

Create a test file like `test/integration/oracle_subquery_repro_test.exs`:

```elixir
defmodule Electric.Integration.OracleSubqueryReproTest do
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
         # 1. Create simple tables (parent + child is usually enough)
         "CREATE TABLE parent (id TEXT PRIMARY KEY, active BOOLEAN NOT NULL DEFAULT true)",
         "CREATE TABLE child (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES parent(id), value TEXT NOT NULL)",
         # 2. Seed the minimal initial state
         "INSERT INTO parent (id, active) VALUES ('p1', true), ('p2', false)",
         "INSERT INTO child (id, parent_id, value) VALUES ('c1', 'p1', 'v1'), ('c2', 'p2', 'v2')"
       ]
  test "description of the bug", ctx do
    # 3. Define shape(s) — usually one is enough
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

    # 4. Define batches — each batch is a list of transactions,
    #    each transaction is a list of mutations
    batches = [
      [  # batch 1
        [  # transaction 1
          %{name: "mut1", sql: "UPDATE parent SET active = false WHERE id = 'p1'"},
          %{name: "mut2", sql: "UPDATE parent SET active = true WHERE id = 'p2'"},
          %{name: "mut3", sql: "UPDATE child SET parent_id = 'p2' WHERE id = 'c1'"}
        ]
      ]
    ]

    test_against_oracle(ctx, shapes, batches)
  end
end
```

### Step 4: Simplify iteratively

Run with `mix test --only oracle test/integration/oracle_subquery_repro_test.exs`.

Reduce until you find the minimal trigger:
- Remove mutations one at a time — does it still fail?
- Remove seed data rows — are all rows needed?
- Simplify the WHERE clause — is the subquery depth needed?
- Try with a single parent change vs. multiple

For example, the duplicate-insert bug requires:
- A child already in the shape (c1 via active p1)
- Another child NOT in the shape (c2 via inactive p2) — needed so the move-in query has real work to do
- A single transaction that triggers both move-out (deactivate p1) AND move-in (activate p2) AND changes the child's FK (c1 → p2)

### Tips

- **Use `with_sql_execute`** for schema + seed data via `@tag with_sql: [...]`. This runs before the stack starts, so Electric sees the tables.
- **Keep tables simple**: parent (id, active) + child (id, parent_id, value) covers most subquery bugs. Only use the full 4-level hierarchy if the bug specifically involves nested subqueries.
- **One shape is usually enough**: the oracle property test runs hundreds, but bugs are per-shape.
- **Put all mutations in one transaction** (one inner list) to test atomic interactions, or split across transactions to test sequential behavior.
- **The `optimized: false` flag** means the shape is expected to potentially get 409'd. Set to `true` if the bug is about a shape that should NOT be invalidated.

---

## Likely Failure Modes to Investigate

1. **Missing synthetic delete**: Client receives move-out but tag_to_keys doesn't have the matching tag, so no delete is generated. Row stays in materialized view but shouldn't.

2. **Missing move-out**: Materializer doesn't emit move_out when it should (value count goes to 0 but event is lost).

3. **Tag mismatch**: Tag computed by `fill_move_tags` on the server doesn't match the tag in the move-out pattern from `make_move_out_control_message`. Could happen if the hashing inputs differ (e.g., NULL handling, different column values).

4. **Stale tag on client**: Client has tag from initial insert, but an UPDATE changed the tag (via `removed_move_tags`). If the `removed_tags` header was lost or not processed, the old tag lingers and a subsequent move-out won't fully clean up.

5. **Race between move-in query and WAL changes**: A change arrives via WAL while a move-in query is in flight. `ChangeHandling` should skip it (covered by move-in), but if the logic in `change_will_be_covered_by_move_in?` is wrong, we get duplicates or missing rows.

6. **Concurrent move-in/move-out**: A value moves out of the inner shape while a move-in query for it is still in flight. The `moved_out_tags` tracking in `MoveIns` should handle this, but edge cases may exist.

7. **Multi-subquery / OR / NOT interactions**: Shapes with OR + subquery or NOT IN should invalidate (409), not use tags. If `should_invalidate?` logic is wrong, broken tag behavior occurs.
