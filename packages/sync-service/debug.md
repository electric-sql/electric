## Architecture: How Subquery Moves Work

### The Problem

A shape like `SELECT * FROM level_4 WHERE level_3_id IN (SELECT id FROM level_3 WHERE active = true)` depends on data in `level_3`. When `level_3.active` changes, rows in `level_4` may move in or out of the shape *without any change to level_4 itself*.

### The Solution: Tags + Move In/Out

Electric uses a "tag" system to track *why* each row is in a shape, so it can generate synthetic deletes when that reason no longer holds.

### Component Roles

#### 1. Inner Shape Materializer (`lib/electric/shapes/consumer/materializer.ex`)

The subquery `SELECT id FROM level_3 WHERE active = true` is itself a shape. Its **Materializer** maintains:
- `index`: key -> materialized value (the `id` column value)
- `value_counts`: value -> reference count
- `tag_indices`: tag_hash -> MapSet of keys

When a change alters the value set:
- **New unique value** (count 0 -> 1): emit `:move_in` event
- **Last reference removed** (count 1 -> 0): emit `:move_out` event

Events are sent to subscriber consumers via `{:materializer_changes, shape_handle, %{move_in: [...], move_out: [...]}}`.

#### 2. Outer Shape Consumer (`lib/electric/shapes/consumer.ex`)

Receives `{:materializer_changes, dep_handle, events}` in `handle_info`. Decides whether to:
- **Invalidate** (stop_and_clean): if tagged subqueries disabled, or shape has OR/NOT with subquery, or multiple subqueries
- **Process**: delegates to `MoveHandling`

#### 3. MoveHandling (`lib/electric/shapes/consumer/move_handling.ex`)

**Move-ins** (`process_move_ins`):
1. Builds a WHERE clause replacing the subquery with the new values
2. Fires an async query against Postgres to get matching level_4 rows
3. Tracks the move-in as "waiting" in `MoveIns` state
4. When query completes (`query_complete`): splices results into the shape log, transitions to "filtering"

**Move-outs** (`process_move_outs`):
1. Creates a move-out control message with tag patterns (hashed values)
2. Appends control message to the shape log
3. Tracks moved-out tags for concurrent move-in filtering

#### 4. ChangeHandling (`lib/electric/shapes/consumer/change_handling.ex`)

Filters WAL changes for shapes with dependencies. Key decisions:
- Skip if change is already visible in a resolved move-in snapshot
- Skip if change will be covered by a pending move-in (unless sublink value changed in an UPDATE)
- For updates: check old_record against pre-move refs, new_record against post-move refs

#### 5. Tag Computation (`lib/electric/shapes/shape.ex` - `fill_move_tags`)

Tags are computed in `convert_change` -> `fill_move_tags`:
- **tag_structure**: derived from the WHERE clause's subquery column references (e.g., `[["level_3_id"]]`)
- **Tag value**: `MD5(stack_id + shape_handle + "v:" + column_value)` - a hash that's unique per shape
- For inserts/deletes: `move_tags` = tags from current record
- For updates: `move_tags` = tags from new record, `removed_move_tags` = tags from old record that aren't in new

Tags are serialized into the log as `headers.tags` and `headers.removed_tags`.

#### 6. Client-Side TagTracker (`packages/elixir-client/lib/electric/client/tag_tracker.ex`)

Maintains two maps:
- `tag_to_keys`: tag_hash -> set of keys that have this tag
- `key_data`: key -> {tags: set of tag_hashes, msg: last ChangeMessage}

On each ChangeMessage: updates tag tracking.

On MoveOutMessage: removes matching tags from keys. If a key has **no remaining tags**, generates a **synthetic delete**.

#### 7. Client-Side Poll (`packages/elixir-client/lib/electric/client/poll.ex`)

Processes messages in order: ChangeMessages update tag state, MoveOutMessages trigger synthetic deletes via TagTracker.

### Data Flow (Happy Path)

```
Postgres WAL change to level_3 (e.g., active = false -> true)
    |
    v
ShapeLogCollector dispatches to inner shape's Consumer
    |
    v
Inner Consumer's convert_change: level_3 row matches WHERE -> NewRecord with tags
    |
    v
Inner Consumer writes to log, notifies Materializer via new_changes
    |
    v
Materializer.apply_changes: value count 0->1 = move_in event
    |
    v
{:materializer_changes, inner_handle, %{move_in: [{value, string}]}}
    |
    v
Outer Consumer.handle_info -> MoveHandling.process_move_ins
    |
    v
Async query: SELECT * FROM level_4 WHERE level_3_id = ANY($1) [new values]
    |
    v
Results written to temp storage, :query_move_in_complete message
    |
    v
MoveHandling.query_complete: splice into main log
    |
    v
Client polls, receives new inserts with tags
    |
    v
TagTracker.update_tag_index: tracks key -> tag mapping
```

Move-out is similar but in reverse: materializer emits move_out -> Consumer writes move-out control message -> client TagTracker generates synthetic deletes.

---

## Adding Debug Logging

Debug logging has been removed from the codebase. To re-add it, add `IO.puts("[dbg:move] ...")` calls at the locations below. Prefix all lines with `[dbg:move]` so you can grep for them.

### Server-side (`packages/sync-service`)

| Location | What to Log |
|----------|-------------|
| `materializer.ex:apply_changes_and_notify` (inside `if events != %{}`) | `events[:move_in]`, `events[:move_out]`, `state.tag_indices` |
| `materializer.ex:apply_changes` NewRecord branch | `key`, `move_tags`, `original_string` |
| `materializer.ex:apply_changes` UpdatedRecord branch | `key`, `move_tags`, `removed_move_tags`, `columns_present` |
| `materializer.ex:apply_changes` DeletedRecord branch | `key`, `move_tags` |
| `materializer.ex:apply_changes` move-out branch | `patterns`, `Map.keys(tag_indices)`, popped `keys` |
| `consumer.ex:handle_info({:materializer_changes, ...})` | `state.shape_handle`, `dep_handle`, `move_in`, `move_out` |
| `move_handling.ex:process_move_ins` | `dep_handle`, `new_values`, `formed_where_clause` |
| `move_handling.ex:process_move_outs` | `dep_handle`, `removed_values`, `message` |
| `move_handling.ex:query_complete` | `name`, `key_set`, `snapshot`, `moved_out_tags[name]` |
| `shape.ex:fill_move_tags` (all 3 clauses) | `shape_handle`, `key`, computed `move_tags`, `tag_structure` |

### Client-side (`packages/elixir-client`)

| Location | What to Log |
|----------|-------------|
| `tag_tracker.ex:update_tag_index` (when tags non-empty) | `key`, `headers.operation`, `new_tags`, `removed_tags` |
| `tag_tracker.ex:generate_synthetic_deletes` | `patterns`, `Map.keys(tag_to_keys)`, `Map.keys(key_data)`, generated delete keys |
| `poll.ex:handle_message(MoveOutMessage)` | `state.shape_handle`, `patterns`, `length(synthetic_deletes)` |

### Filtering

```bash
grep '\[dbg:move\]' /tmp/oracle_debug.log                # all move debug
grep '\[dbg:move\] CLIENT' /tmp/oracle_debug.log          # client-side only
grep '\[dbg:move\] MATERIALIZER' /tmp/oracle_debug.log    # materializer events
grep '\[dbg:move\] MOVE_HANDLING' /tmp/oracle_debug.log   # consumer move processing
grep '\[dbg:move\] CONSUMER' /tmp/oracle_debug.log        # consumer receiving events
```

---

## Key Files Reference

### Server-side
- `lib/electric/shapes/consumer.ex` - Main consumer GenServer, receives WAL events and materializer events
- `lib/electric/shapes/consumer/materializer.ex` - Materializes inner subquery shapes, emits move_in/move_out
- `lib/electric/shapes/consumer/move_handling.ex` - Processes move-in queries and move-out control messages
- `lib/electric/shapes/consumer/move_ins.ex` - State management for in-flight move-ins, filtering, touch tracking
- `lib/electric/shapes/consumer/change_handling.ex` - Filters WAL changes, skips duplicates from move-ins
- `lib/electric/shapes/shape.ex` - `convert_change`, `fill_move_tags`, `make_tags_from_pattern`
- `lib/electric/shapes/shape/subquery_moves.ex` - Tag hashing, move-out patterns, move-in WHERE clause construction
- `lib/electric/log_items.ex` - Serializes tags into JSON log entries

### Client-side
- `lib/electric/client/poll.ex` - Polling API, processes messages, handles MoveOutMessage
- `lib/electric/client/tag_tracker.ex` - Tag index, synthetic delete generation
- `lib/electric/client/shape_state.ex` - Holds tag_to_keys and key_data between polls
- `lib/electric/client/message.ex` - Message parsing (tags from headers)

### Test infrastructure
- `test/integration/oracle_property_test.exs` - The test itself
- `test/support/oracle_harness.ex` - Test runner, applies SQL, checks shapes
- `test/support/oracle_harness/shape_checker.ex` - Per-shape GenServer, polls + compares against oracle
- `test/support/oracle_harness/standard_schema.ex` - Schema, seed data, shape/mutation generation
- `test/support/oracle_harness/where_clause_generator.ex` - StreamData WHERE clause generator

---

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
