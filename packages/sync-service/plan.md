# ✅ Goal (Option 1): OR-combined subqueries without 409/must-refetch

Support shapes like:

```sql
WHERE x IN (subquery1) OR y IN (subquery2)
```

…and make the shape update correctly when either subquery’s result set changes, **without** invalidation / must-refetch.

Core idea (Option 1):

* Every row carries a **set of tags**: “reasons this row is in the shape”.
* When a dependency moves-in values, the outer shape runs a move-in query and emits INSERTs tagged with those values.

  * If the row already exists due to another reason, the client treats INSERT as **UPSERT** and merges tag sets.
* When a dependency moves-out values, the outer shape emits a `move-out` control event with tag-patterns.

  * Client removes only those tags; deletes the row **only if tag set becomes empty**.

This requires work in **three places**:

1. **Server tagging correctness** (Elixir sync-service)
2. **Internal “client” correctness** (the dependency `Materializer` in sync-service)
3. **External clients correctness** (TypeScript client `Shape`)

---

# Overview of main files touched (high-level)

| Component                     | Where                                                | Why                                                             |
| ----------------------------- | ---------------------------------------------------- | --------------------------------------------------------------- |
| Allow multiple subqueries     | `packages/sync-service/lib/electric/shapes/shape.ex` | Remove current “single subquery only” validation                |
| Tag structure generation      | `.../shape/subquery_moves.ex`                        | Must represent multiple subqueries correctly and per-dependency |
| Move-in query rewriting       | `.../shape/subquery_moves.ex`                        | Must avoid OR returning unrelated rows (and prevent wrong tags) |
| Move-out patterns             | `.../shape/subquery_moves.ex`                        | Must remove tags for only the correct dependency                |
| Tag emission in change stream | `.../shapes/shape.ex`                                | Must compute tags conditionally (based on actual membership)    |
| Move-out application          | `.../consumer/materializer.ex`                       | Must support multiple tags per row and not delete too early     |
| Remove invalidation           | `.../consumer.ex`, `.../consumer/state.ex`           | Stop issuing `must-refetch` when OR+subquery present            |
| TS Client tag/index logic     | `packages/typescript-client/src/shape.ts`            | Must apply move-out events + UPSERT merge tags                  |

---

# Phase 0 — Establish invariants (must-haves)

Before implementing, align on these invariants:

### ✅ Tag identity MUST be dependency-specific

If both subqueries can contain the same values (e.g. both return `42`), their tags **must not collide**.

So tag hashing must include:

* stack_id
* shape_handle
* dependency index (or something derived from `$sublink/N`)
* value

**New hash seed**:

```
md5(stack_id <> shape_handle <> "sublink:" <> index <> ":" <> value)
```

### ✅ A row may have multiple tags

So:

* inserts can add tags
* updates can add/remove tags
* move-out removes tags
* row deleted only when tags empty

---

# Phase 1 — Lift validation that blocks multiple subqueries

### 1.1 Remove `check_single_subquery/1` restriction

**File:**
`packages/sync-service/lib/electric/shapes/shape.ex`

**Current:**
`check_single_subquery/1` errors if `length(subqueries) > 1`.

**Change:**
Replace with a validator that allows multiple subqueries but still rejects *unsupported* structures (for now).

MVP support target:

* multiple `IN (SELECT …)` at same boolean level, typically OR-connected.

If you want a staged rollout:

* allow multiple subqueries **only if** the eval AST contains **no AND node whose subtree contains more than one sublink check**
* (later you can expand to full DNF)

---

# Phase 2 — Rebuild tag_structure to support multiple subqueries safely

## 2.1 Change what “tag_structure” represents

Right now:

* `shape.tag_structure` is just a list like `[[ "parent_id" ]]`
* and move-outs assume “one dependency” → apply all patterns → wrong for multi

### New representation (recommended)

In `Shape` struct, store tag structure as:

```elixir
tag_structure :: %{
  ["$sublink","0"] => [ "x" ] | [{:hash_together, ["col1","col2"]}],
  ["$sublink","1"] => [ "y" ] | ...
}
```

i.e. **map per dependency**.

This ensures:

* move-outs can target the correct dependency
* tags don’t get created for unrelated dependencies

## 2.2 Update `SubqueryMoves.move_in_tag_structure/1`

**File:**
`packages/sync-service/lib/electric/shapes/shape/subquery_moves.ex`

Currently it uses `Walker.reduce` and builds a **single list** of tags and may combine sublinks incorrectly.

Instead:

* Walk the AST and build:

  * `comparison_expressions` (already does this)
  * **dependency->pattern mapping** (new)

Pseudo:

```elixir
%Func{name: "sublink_membership_check", args: [testexpr, sublink_ref]} ->
  pattern = case testexpr do
    %Ref{path: [col]} -> [col]
    %RowExpr{elements: refs} -> [{:hash_together, Enum.map(refs, &hd(&1.path))}]
  end

  tag_structure = Map.put(tag_structure, sublink_ref.path, pattern)
```

Return:

```elixir
{tag_structure_map, comparison_expressions_map}
```

Then update `Shape.fill_tag_structure/1` to store map instead of list.

---

# Phase 3 — Fix tag hashing + move-out patterns for multiple dependencies

## 3.1 Update hashing to include dependency index (or sublink path)

**File:**
`packages/sync-service/lib/electric/shapes/shape/subquery_moves.ex`

Change:

```elixir
def make_value_hash(stack_id, shape_handle, value)
```

to:

```elixir
def make_value_hash(stack_id, shape_handle, sublink_index, value)
```

(or pass `"0"` instead of integer, your choice)

Keep the old 3-arg as wrapper for backward compatibility if needed.

## 3.2 Update `make_move_out_pattern` so it only emits tags for that dependency

Currently it iterates **all patterns** and hashes all gone_values → catastrophic for multi.

New plan:

* Determine dependency index:

  * `index = Enum.find_index(shape.shape_dependencies_handles, &(&1 == dep_handle))`
  * `sublink_ref = ["$sublink", Integer.to_string(index)]`
* Fetch the pattern for that sublink from tag_structure map.
* Hash only those gone values using that sublink index.

---

# Phase 4 — Make move-in query safe for OR and compatible with UPSERT merge tags

## 4.1 Fix `move_in_where_clause/3` to avoid OR pulling unrelated rows

**File:**
`.../shape/subquery_moves.ex`

Problem: if you only replace the subquery with `ANY($1)` but leave `OR y IN (subq2)`, the query can return rows unrelated to this move-in.

Solution from RFC Option 1:

* Keep full WHERE (so branch-specific predicates still apply)
* BUT add an extra AND constraint forcing the moved-in part to be true:

  * single column: `AND x = ANY($1::...)`
  * composite: `AND (col1,col2) IN (SELECT * FROM unnest(...))`

So the move-in query becomes effectively “rows for THIS dependency moved-in values only”, even under OR.

Implementation approach:

* you already know the `testexpr` from `subquery_comparison_expressions` map.
* construct a second “membership using params” clause (`forced_clause`)
* return:

```elixir
{
  "(#{replaced_query}) AND #{forced_clause}",
  params
}
```

✅ This is crucial to stop 409/must-refetch behaviour caused by OR.

---

# Phase 5 — Ensure normal replication changes produce correct tag sets

This is where OR correctness is actually made complete.

## 5.1 Tags must be conditional on actual membership

Right now `Shape.fill_move_tags/4` always hashes the column values. For OR this is unsafe (creates “phantom reasons” that never move out).

**File:**
`packages/sync-service/lib/electric/shapes/shape.ex`

### What to do

When filling tags for a record:

* for each dependency (sublink):

  * evaluate the comparison expression on the record (already available in `shape.subquery_comparison_expressions`)
  * check membership in `extra_refs` (which consumer already builds via `Materializer.get_all_as_refs/2`)
  * only then produce the tag hash

This requires passing `extra_refs` into fill_move_tags (currently it only takes stack_id + shape_handle).

For updates:

* compute `new_tags` using new extra_refs
* compute `old_tags` using old extra_refs
* set:

  * `tags = new_tags`
  * `removed_tags = old_tags -- new_tags`

✅ This makes row updates that change `x` or `y` behave correctly even if dependencies don’t change.

---

# Phase 6 — Remove the “OR with subquery” invalidation (the 409 source)

The system currently invalidates any shape that has OR combined with subquery.

## 6.1 Stop invalidating on `state.or_with_subquery?`

**File:**
`packages/sync-service/lib/electric/shapes/consumer.ex`

In `handle_info({:materializer_changes, ...})`:

```elixir
should_invalidate? = not tagged_subqueries_enabled? or state.or_with_subquery?
```

Change to:

```elixir
should_invalidate? = not tagged_subqueries_enabled?
```

(or keep an escape hatch feature flag if desired)

## 6.2 Also remove the invalidation in relation_change handler

**File:**
`packages/sync-service/lib/electric/shapes/consumer.ex`

There’s also a path that invalidates on `state.or_with_subquery?` during relation changes. Remove that.

---

# Phase 7 — Upgrade internal Materializer to behave like Option 1 “client”

This is required because `Materializer` consumes logs and currently assumes “one tag per row”.

**File:**
`packages/sync-service/lib/electric/shapes/consumer/materializer.ex`

### 7.1 Extend state with `row_tags`

Add:

```elixir
row_tags: %{} # key => MapSet(tags)
```

### 7.2 Inserts must behave as UPSERT

Currently insert raises if key exists. Replace that logic:

* If key not exists → insert value, set row_tags, update tag_indices, update value_counts
* If key exists → treat as UPSERT:

  * merge tags (`row_tags[key] = union`)
  * update tag_indices accordingly
  * update value if needed

### 7.3 Move-out event must only delete row when all tags removed

Currently move-out:

* pops tag->keys
* deletes all those keys

Replace:

* for each tag pattern:

  * keys = tag_indices[tag]
  * for each key:

    * remove that tag from row_tags[key]
    * if row_tags[key] empty → delete key + update value_counts
  * remove tag from tag_indices

### 7.4 Updates must remove removed_tags and possibly delete rows

For `%Changes.UpdatedRecord{ removed_move_tags: ... }`:

* remove those tags from row_tags and tag_indices
* add new tags
* if tag_set becomes empty → delete row

✅ After this, the Materializer can correctly drive dependency move-ins/outs even for OR.

---

# Phase 8 — Upgrade TypeScript client `Shape` to support tags + move-out

TS client currently ignores:

* `event: "move-out"`
* `headers.tags` / `removed_tags`

**File:**
`packages/typescript-client/src/shape.ts`

### 8.1 Add two indexes

```ts
keyTags: Map<string, Set<string>>
tagKeys: Map<string, Set<string>> // inverse index for fast move-out
```

### 8.2 Treat INSERT as UPSERT

On insert:

* if key not present → insert row and set tags
* else:

  * merge row update (overwrite or shallow-merge as current)
  * union tags

### 8.3 Apply UPDATE with tags and removed_tags

On update:

* apply row patch
* `removed_tags` → remove from keyTags and tagKeys
* `tags` → add to both indexes
* if keyTags empty → delete row

### 8.4 Handle `move-out` event messages

When receiving `{ event: "move-out", patterns }`:

* patterns contain `{pos, value}` but currently server uses `pos=0` always
* treat `value` as a tag id
* lookup `tagKeys.get(value)` → keys
* remove this tag from all those keys
* if any keyTags becomes empty → delete key and row

✅ Now TS client behaves like RFC Option 1.

---

# Phase 9 — Tests (must add)

## 9.1 Unit tests: SubqueryMoves

**File:**
`packages/sync-service/test/electric/shapes/shape/subquery_moves_test.exs`

Add case:

* shape where: `x IN (SELECT ...) OR y IN (SELECT ...)`
* assert tag_structure returns **two entries**
* assert move-out patterns only for correct dep
* assert move_in_where_clause wraps with AND constraint

## 9.2 Unit tests: Materializer

Add new test module:

* insert row with tagA
* UPSERT same row with tagB
* move-out tagA → row remains
* move-out tagB → row deleted

## 9.3 Integration test: no must-refetch on move-in/out

Spin up a mini shape + dependencies (as existing test harness does) and assert:

* move-in leads to inserts
* move-out leads to event
* consumer does not stop_and_clean / invalidate

---

# Phase 10 — Rollout safety toggles

To de-risk:

* behind a feature flag e.g. `"multi_subqueries_same_level"`
* or reuse `"tagged_subqueries"` as gate
* keep old behaviour for single-subquery shapes (optional)

---

# Final checklist (AI agent execution order)

✅ **Do in this exact order:**

1. Remove single-subquery validation (Phase 1)
2. Change tag_structure representation + update SubqueryMoves.move_in_tag_structure (Phase 2)
3. Add dependency-aware hashing + fix move-out patterns (Phase 3)
4. Fix move_in_where_clause with AND-forcing constraint (Phase 4)
5. Make Shape.fill_move_tags conditional using extra_refs (Phase 5)
6. Remove OR invalidation (Phase 6)
7. Upgrade Materializer to UPSERT + multi-tag removal logic (Phase 7)
8. Upgrade TS client similarly (Phase 8)
9. Add tests (Phase 9)
10. Add rollout flag (Phase 10)

---

## What I didn’t fully verify (be explicit)

I did not fully trace:

* whether **subset snapshot queries** (`query_subset`) are used in your move-in/out flow for subqueries; if they are, they also need correct tag computation (same approach as initial snapshot).
* whether any other client (Elixir client, Kotlin client, etc.) consumes move-out events. If they do, they need the same tag-index semantics as TS.

If you tell me which clients are “in play” besides TS, I’ll extend Phase 8 accordingly — without needing more clarification.

