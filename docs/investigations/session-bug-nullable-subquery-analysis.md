# Bug Investigation: Nullable Columns in Subquery WHERE Clauses

**Date:** 2026-01-21
**Reported by:** Kyle Mistele
**Investigated by:** Claude (automated analysis)
**Branch:** `claude/investigate-session-bug-eLXET`

---

## Executive Summary

A user reported crashes when using shapes with WHERE clauses containing `IN (SELECT ...)` subqueries where the column used in the membership check is nullable. **The bug is intermittent** - sometimes it works, sometimes it crashes. Investigation revealed **two distinct issues**:

1. **Primary Bug:** The `subset` encoder doesn't properly handle NULL values in the response stream, causing an `ArgumentError` crash
2. **Design Limitation:** Shapes with OR conditions containing subqueries trigger frequent 409 responses due to intentional invalidation behavior

---

## User's Setup

### Proxy Configuration
```typescript
app.get('/v1/sessions', async (c) => {
    const { organizationId, userId } = c.var.authContext
    const tableName = getTableName(sessions)
    // ... builds WHERE clause with ACL subqueries
})
```

### WHERE Clause Builder
```typescript
const ownershipOrAcl = sql`(
    ${sql.identifier('resource_owner_user_id')} = '${sql.raw(auth.userId)}'
    OR ${sql.identifier(taskIdCol)} IN (
        SELECT ${sql.identifier('task_id')} FROM ${sql.identifier('task_user_acl')}
        WHERE ${sql.identifier('subject_user_id')} = '${sql.raw(auth.userId)}'
        AND ${sql.identifier('organization_id')} = '${sql.raw(auth.organizationId)}'
    )
    OR ${sql.identifier(taskIdCol)} IN (
        SELECT ${sql.identifier('task_id')} FROM ${sql.identifier('task_organization_acl')}
        WHERE ${sql.identifier('organization_id')} = '${sql.raw(auth.organizationId)}'
    )
)`
```

### Key Detail
- The `sessions.task_id` column is **nullable**
- Client uses TanStack DB with `syncMode: 'on-demand'`

---

## Issue 1: NULL Crash in Subset Encoder

### Error Message
```
23:05:47.260 pid=<0.3359.0> request_id=GIyS9_FZOZk_vfIAAAHC [error] ** (ArgumentError) errors were found at the given arguments:

  * 1st argument: not an iodata term

    :erlang.iolist_size(["[", [nil], "]"])

    (electric 1.3.0) lib/electric/shapes/api/response.ex:412: anonymous fn/3 in Electric.Shapes.Api.Response.send_stream/2
```

### Root Cause

**File:** `packages/sync-service/lib/electric/shapes/api/encoder.ex`

The `log/1` function correctly encodes items before streaming:
```elixir
# Line 34-36
def log(item_stream) do
  item_stream |> Stream.map(&ensure_json/1) |> to_json_stream()
end
```

The `subset/1` function does **NOT** encode items:
```elixir
# Line 39-55
def subset({metadata, item_stream}) do
  metadata =
    metadata
    |> Map.update!(:xmin, &to_string/1)
    |> Map.update!(:xmax, &to_string/1)
    |> Map.update!(:xip_list, &Enum.map(&1, fn xid -> to_string(xid) end))

  Stream.concat([
    [
      ~s|{"metadata":|,
      Jason.encode_to_iodata!(metadata),
      ~s|, "data": |
    ],
    to_json_stream(item_stream),  # <-- BUG: item_stream not encoded!
    [~s|}|]
  ])
end
```

### Data Flow Analysis

1. **`Querying.query_subset/6`** (`querying.ex:27-73`) returns rows from PostgreSQL:
   ```elixir
   Postgrex.stream(conn, query, params)
   |> Stream.flat_map(& &1.rows)
   ```
   Each row is `[json_string]` (single-element list)

2. **`PartialModes.query_subset/4`** (`partial_modes.ex:17-19`) collects to list:
   ```elixir
   Querying.query_subset(...) |> Enum.to_list()
   ```
   Result: `[[json1], [json2], ...]`

3. **`to_json_stream/1`** (`encoder.ex:69-76`) intersperses and chunks:
   ```elixir
   Stream.concat([
     [@json_list_start],              # "["
     Stream.intersperse(items, ","),  # [json1], ",", [json2], ...
     [@json_list_end]                 # "]"
   ])
   |> Stream.chunk_every(500)
   ```

4. **When JSON is NULL from PostgreSQL**, the row becomes `[nil]`:
   - `[nil]` is placed in the iodata stream
   - `IO.iodata_length([nil])` crashes because `nil` is not valid iodata

### Why PostgreSQL Might Return NULL

The `json_like_select` function in `querying.ex:163-193` constructs JSON with `coalesce` for individual column values. However, there may be edge cases where:
- The overall JSON concatenation fails
- Dependent shape queries have different query paths
- Complex WHERE clause evaluation causes unexpected behavior

**Note:** This needs further investigation to determine exactly when PostgreSQL returns NULL for the JSON column.

### Suggested Fix

**Option A: Fix in encoder (minimal change)**
```elixir
def subset({metadata, item_stream}) do
  metadata = ...

  Stream.concat([
    [...],
    item_stream
    |> Stream.flat_map(fn
      [item] when is_binary(item) -> [item]
      [nil] -> []  # Skip NULL rows or encode as JSON null
      [item] -> [Jason.encode_to_iodata!(item)]
    end)
    |> to_json_stream(),
    [~s|}|]
  ])
end
```

**Option B: Fix in query_subset (consistent format)**

Make `query_subset` return the same format as `stream_initial_data`:
```elixir
# In querying.ex query_subset/6
Postgrex.stream(conn, query, params)
|> Stream.flat_map(& &1.rows)
|> Stream.flat_map(fn
  [item] when not is_nil(item) -> [item]
  [nil] -> []
end)
```

---

## Issue 2: OR with Subqueries Triggers 409 Responses

### Observed Behavior

User reports frequent HTTP 409 responses that the `onError` callback doesn't catch properly.

### Root Cause

**File:** `packages/sync-service/lib/electric/shapes/consumer.ex:288-296`

```elixir
# When changes occur in dependent shapes:
should_invalidate? =
  not tagged_subqueries_enabled? or
  state.or_with_subquery? or           # TRUE for user's query
  state.not_with_subquery? or
  length(state.shape.shape_dependencies) > 1  # TRUE - 2 subqueries

if should_invalidate? do
  stop_and_clean(state)  # Triggers 409 on next request
end
```

### Detection Logic

**File:** `packages/sync-service/lib/electric/shapes/consumer/state.ex:150-183`

```elixir
defp has_or_with_subquery?(%Shape{where: where}) do
  Walker.reduce!(
    where.eval,
    fn
      %Parser.Func{name: "or"} = or_node, acc, _ctx ->
        if subtree_has_sublink?(or_node) do
          {:ok, true}  # Found OR containing subquery reference
        else
          {:ok, acc}
        end
      _node, acc, _ctx ->
        {:ok, acc}
    end,
    false
  )
end
```

### User's Query Structure

```sql
WHERE organization_id = '...' AND (
  resource_owner_user_id = '...'
  OR task_id IN (SELECT task_id FROM task_user_acl WHERE ...)    -- sublink 0
  OR task_id IN (SELECT task_id FROM task_organization_acl ...)  -- sublink 1
)
```

This triggers TWO invalidation conditions:
1. `or_with_subquery? = true` - OR node contains sublink references
2. `length(shape_dependencies) = 2` - Multiple same-level subqueries

### Why This Is By Design

Comment in `consumer.ex:289-290`:
> "the shape has multiple subqueries at the same level since we can't correctly determine which dependency caused the move-in/out"

Electric cannot track which specific subquery caused a change, so it conservatively invalidates the entire shape.

---

## Issue 3: IS NOT NULL Workaround Doesn't Help

### User's Attempted Fix

```typescript
const ownershipOrAcl = sql`(
    ${sql.identifier('resource_owner_user_id')} = '${sql.raw(auth.userId)}'
    OR (${sql.identifier(taskIdCol)} IS NOT NULL AND ${sql.identifier(taskIdCol)} IN (
        SELECT ${sql.identifier('task_id')} FROM ${sql.identifier('task_user_acl')}
        WHERE ...
    ))
    OR (${sql.identifier(taskIdCol)} IS NOT NULL AND ${sql.identifier(taskIdCol)} IN (
        SELECT ${sql.identifier('task_id')} FROM ${sql.identifier('task_organization_acl')}
        WHERE ...
    ))
)`
```

### Why It Doesn't Help

1. **Structure unchanged:** The AST still has OR nodes containing sublink references
2. **Still multiple subqueries:** `length(shape_dependencies) > 1` still true
3. **Invalidation still triggers:** Both conditions for `should_invalidate?` remain true

### User Report
> "I added a guard to not run the inarray if it's null but that appears to be breaking something because in certain cases things don't sync"

The "breaking" is likely the continued 409 invalidation cycle, not the IS NOT NULL guard itself.

---

## Intermittent Behavior Analysis

**User Report:** "the weird thing is that sometimes this works and sometimes it doesn't"

### Possible Causes for Intermittent Failures

#### 1. Data-Dependent (Most Likely)
The crash only occurs when ALL conditions are met:
- A row with `task_id = NULL` exists in `sessions` table
- That row matches the WHERE clause (e.g., via `resource_owner_user_id` match)
- That row is included in the current response

If the matching rows all have non-NULL `task_id` values, no crash occurs.

#### 2. Response Path Dependent
Different request types use different encoders:

| Request Type | Encoder | Has Bug? |
|--------------|---------|----------|
| Initial snapshot from storage | `log/1` | No |
| Subset query (on-demand sync) | `subset/1` | **Yes** |
| Live/polling requests | `log/1` | No |
| Cached/stored log reads | `log/1` | No |

With TanStack DB's `syncMode: 'on-demand'`, subset queries are triggered dynamically. But if:
- Shape already exists with cached snapshot → serves via `log/1` (works)
- Fresh subset query triggered → uses `subset/1` (may crash)

#### 3. Timing/Race Conditions
- Shape exists and is up-to-date → log path (works)
- Shape being created → might hit subset path (crashes)
- Shape invalidated via 409 → refetch might take different path
- Dependent shape changes → triggers invalidation → different behavior

### To Reproduce Consistently
Try to ensure:
1. Shape doesn't exist yet (delete shape or use new handle)
2. Query specifically requests subset (`subset` param in request)
3. Data includes rows where `task_id IS NULL` but row matches via `resource_owner_user_id`

### Questions to Clarify
- Does it fail more on first load vs subsequent loads?
- Does failure correlate with rows where `task_id` is NULL?
- Does it happen specifically after a 409 refresh cycle?

---

## Critical Finding: Empty Dependent Shapes

**User Test Results:**

| Session task_id | Tasks in DB | ACL tables likely | Result |
|-----------------|-------------|-------------------|--------|
| NULL | No tasks seeded | Empty | **CRASH** |
| NULL | Task seeded (not referenced by session) | Has entries | Works |
| task.id | Task seeded | Has entries | Works |

**The crash correlates with EMPTY dependent shapes, not NULL values in sessions!**

When no tasks exist:
1. The ACL tables (`task_user_acl`, `task_organization_acl`) are likely empty
2. The dependent shapes created for `SELECT task_id FROM task_user_acl WHERE ...` have **no data**
3. Something about serializing a response when dependent shapes are empty causes the crash

### Hypothesis

The materializer's `get_link_values` returns an empty `MapSet.new([])` when dependent shapes have no data. This empty set is used somewhere in the response serialization, and there's a bug handling the empty case.

**File to investigate:** `lib/pg_interop/sublink.ex`
```elixir
def member?(value, %MapSet{} = set) do
  MapSet.member?(set, value)
end
```

The membership check itself is fine, but somewhere in the serialization path, an empty dependent shape result may be causing NULL to be written to the response.

### Further Testing Revealed: Race Condition

**Critical Finding:** User added SELECT statements (just reading DB, no data changes) to the failing test, and it started passing!

This confirms the issue is a **timing/race condition**, not a data issue:
- Inserting a task adds delay → works
- Running SELECT statements adds delay → works
- No delay → crashes

**The bug:** Electric reports a shape as "ready" before the dependent shape materializers have finished initializing.

### Evidence in Code

**File:** `lib/electric/shapes/consumer/materializer.ex:4`
```elixir
# - [ ] Think about initial materialization needing to finish before we can continue
```

This TODO suggests developers are aware of this issue.

**`wait_until_ready` implementation (line 162-163):**
```elixir
def handle_call(:wait_until_ready, _from, state) do
  {:reply, :ok, state}  # Returns immediately!
end
```

But actual data loading happens in `handle_continue({:read_stream, storage}, state)` which is **async**.

### Race Condition Flow

```
1. Client requests shape with subquery dependencies
2. Electric creates main shape + dependent shapes (task_user_acl, task_organization_acl)
3. Dependent shape consumers start → materializers start
4. Main shape says "snapshot started!" (too early)
5. Client makes query request
6. Materializer.get_all_as_refs() called
7. get_link_values() returns before materializer has read stream
8. Something wrong is returned (nil? wrong format?)
9. Encoder crashes with ["[", [nil], "]"]
```

### Files to Investigate

| File | Concern |
|------|---------|
| `lib/electric/shapes/consumer/materializer.ex` | `handle_continue({:read_stream, ...})` is async - race with `get_link_values` |
| `lib/electric/shape_cache.ex` | How shapes with deps report readiness |
| `lib/electric/shapes/consumer.ex` | `await_snapshot_start` doesn't wait for dependent materializers |

### Suggested Fix

The dependent shape materializers need to signal when they've finished their initial `handle_continue({:read_stream, ...})` before the main shape can report as ready.

---

## Electric Logs Analysis

```
23:05:47.161 [info] Creating new shape for Shape.new!({16735, "public.task_user_acl"},
  where: "subject_user_id = 'user_sessions_test' AND organization_id = '...'",
  columns: ["task_id"]) with handle 6595059-1768950347161624

23:05:47.162 [info] Creating new shape for Shape.new!({16717, "public.task_organization_acl"},
  where: "organization_id = '...'",
  columns: ["task_id"]) with handle 62011584-1768950347162118

23:05:47.162 [info] Creating new shape for Shape.new!({16472, "public.sessions"},
  where: "organization_id = '...' AND (resource_owner_user_id = '...' OR task_id IN (SELECT ...) OR task_id IN (SELECT ...))",
  deps: [{"6595059-...", Shape.new!(...)}, {"62011584-...", Shape.new!(...)}])
  with handle 18218888-1768950347162432
```

**Key observations:**
- Electric correctly identifies and creates dependent shapes
- Dependent shapes select only `task_id` column
- Main shape has `deps` referencing both dependent shapes
- Crash occurs ~100ms after shape creation during response streaming

---

## Recommendations

### Immediate Fix (Bug)
Fix the encoder to handle NULL values in subset responses. This is a clear bug.

### Documentation (Limitation)
Document the limitation that OR conditions with subqueries trigger shape invalidation. Users should be aware this causes frequent 409 responses.

### Future Enhancement (Feature)
Consider supporting OR with subqueries by:
- Tracking which specific dependency caused changes
- Only invalidating when the triggering dependency is in the OR branch
- This is complex and may not be feasible with current architecture

### User Guidance
For the user's ACL use case, suggest alternatives:
1. **Single combined subquery:**
   ```sql
   task_id IN (
     SELECT task_id FROM task_user_acl WHERE ...
     UNION
     SELECT task_id FROM task_organization_acl WHERE ...
   )
   ```
   (Still has OR with subquery issue)

2. **Server-side filtering:** Apply ACL filtering in the proxy after receiving Electric data

3. **Separate shapes:** Create separate shapes for each ACL condition and merge client-side

---

## Files Referenced

| File | Lines | Purpose |
|------|-------|---------|
| `lib/electric/shapes/api/encoder.ex` | 34-76 | Encoder bug location |
| `lib/electric/shapes/api/response.ex` | 403-439 | Crash location (send_stream) |
| `lib/electric/shapes/querying.ex` | 27-73 | query_subset function |
| `lib/electric/shapes/partial_modes.ex` | 8-42 | query_subset wrapper |
| `lib/electric/shapes/consumer.ex` | 288-296 | Invalidation logic |
| `lib/electric/shapes/consumer/state.ex` | 150-204 | OR/NOT detection |
| `lib/electric/replication/eval/parser.ex` | 771-817 | Sublink parsing |

---

## Test Cases Needed

1. **Subset with NULL JSON values:** Verify encoder handles NULL gracefully
2. **OR with single subquery:** Verify invalidation behavior
3. **OR with multiple subqueries:** Verify invalidation behavior
4. **Nullable column in subquery membership check:** End-to-end test

---

## Related Discussions

- [Electric RFC on 409 responses](https://github.com/electric-sql/electric/discussions/2931)
