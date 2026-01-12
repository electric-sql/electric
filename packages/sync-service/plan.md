# ✅ Goal (Option 1): Full DNF support for subqueries without 409/must-refetch

Support shapes like:

```sql
WHERE x IN (subquery1) OR y IN (subquery2)
WHERE x IN (subquery1) AND y IN (subquery2)
WHERE x IN (subquery1) AND (y IN (subquery2) OR z IN (subquery3))
```

…and make the shape update correctly when any subquery result changes, **without** invalidation / must-refetch.

Core idea (Option 1):

* Every row carries a **set of tags**: “reasons this row is in the shape”.
* When a dependency moves-in values, the outer shape runs a move-in query and emits INSERTs tagged with those values.

  * If the row already exists due to another reason, the consumer treats INSERT as **UPSERT** and merges tag sets.
* When a dependency moves-out values, the outer shape emits a `move-out` control event with tag-patterns.

  * Consumer removes only those tags; deletes the row **only if tag set becomes empty**.

This requires work in **two places**:

1. **Server tagging correctness** (Elixir sync-service)
2. **Internal “client” correctness** (the dependency `Materializer` in sync-service)

---

# Overview of main files touched (high-level)

| Component                     | Where                                                | Why                                                             |
| ----------------------------- | ---------------------------------------------------- | --------------------------------------------------------------- |
| Allow multiple subqueries     | `packages/sync-service/lib/electric/shapes/shape.ex` | Remove current “single subquery only” validation                |
| Full DNF extraction           | `.../shape/subquery_moves.ex`                        | Required for nested OR/AND correctness                          |
| Tag structure generation      | `.../shape/subquery_moves.ex`                        | Must represent multiple subqueries correctly and per-dependency |
| Move-in query rewriting       | `.../shape/subquery_moves.ex`                        | Must avoid OR returning unrelated rows (and prevent wrong tags) |
| Move-out patterns             | `.../shape/subquery_moves.ex`                        | Must remove tags for only the correct dependency                |
| Tag emission in change stream | `.../shapes/shape.ex`                                | Must compute tags conditionally (based on actual membership)    |
| Move-out application          | `.../consumer/materializer.ex`                       | Must support multiple tags per row and not delete too early     |
| Remove invalidation           | `.../consumer.ex`, `.../consumer/state.ex`           | Stop issuing `must-refetch` when OR+subquery present            |

---

# Phase 0 — Establish invariants (must-haves)

### ✅ Tag identity MUST be dependency-specific

If both subqueries can contain the same values (e.g. both return `42`), their tags **must not collide**.

So tag hashing must include:

* stack_id
* shape_handle
* dependency index (or something derived from `$sublink/N`)
* value

**Hash seed**:

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

# Phase 1 — Remove legacy validation

### 1.1 Remove `check_single_subquery/1` restriction

**File:**
`packages/sync-service/lib/electric/shapes/shape.ex`

**Change:** allow multiple subqueries with full DNF support (no staged restriction).

---

# Phase 2 — Full DNF extraction (required)

### 2.1 Convert WHERE AST to full DNF

**File:**
`packages/sync-service/lib/electric/shapes/shape/subquery_moves.ex`

**Requirement:** distribute AND over OR so nested boolean forms are correctly represented.

Example:

```
A AND (B OR C)  =>  (A AND B) OR (A AND C)
```

### 2.2 Update `extract_dnf_structure/1`

Use the DNF builder to return a list of disjunct ASTs before extracting sublink patterns.

---

# Phase 3 — Rebuild tag_structure to support multiple subqueries safely

## 3.1 Change what “tag_structure” represents

In `Shape` struct, store tag structure as:

```elixir
tag_structure :: %{
  ["$sublink","0"] => [ "x" ] | [{:hash_together, ["col1","col2"]}],
  ["$sublink","1"] => [ "y" ] | ...
}
```

## 3.2 Update `SubqueryMoves.move_in_tag_structure/1`

Return `{tag_structure_map, comparison_expressions_map}` built per dependency.

---

# Phase 4 — Fix tag hashing + move-out patterns for multiple dependencies

## 4.1 Update hashing to include dependency index

**File:** `packages/sync-service/lib/electric/shapes/shape/subquery_moves.ex`

```elixir
def make_value_hash(stack_id, shape_handle, sublink_index, value)
```

## 4.2 Update `make_move_out_pattern` to emit correct patterns

Use dependency index and tag_structure map; emit only patterns for the moved-out dependency.

---

# Phase 5 — Make move-in query safe for OR

## 5.1 Fix `move_in_where_clause/3` to avoid OR pulling unrelated rows

Add forced AND constraint for the moved-in dependency so OR branches do not leak rows.

---

# Phase 6 — Ensure normal replication changes produce correct tag sets

## 6.1 Tags must be conditional on actual membership

`Shape.fill_move_tags/4` must evaluate membership per dependency via `extra_refs` and only tag when the row actually matches the sublink values.

For updates:

* compute `new_tags`
* compute `old_tags`
* set `removed_tags = old_tags -- new_tags`

---

# Phase 7 — Remove the “OR with subquery” invalidation (409 source)

**File:** `packages/sync-service/lib/electric/shapes/consumer.ex`

Remove any invalidation paths triggered by OR+subquery.

---

# Phase 8 — Upgrade internal Materializer to behave like Option 1 “client”

**File:** `packages/sync-service/lib/electric/shapes/consumer/materializer.ex`

### 8.1 Extend state with `row_tags`

```elixir
row_tags: %{} # key => MapSet(tags)
```

### 8.2 Inserts must behave as UPSERT

If key exists, merge tags and update value counts; otherwise insert.

### 8.3 Move-out must remove only matching tags

For AND-combined disjuncts, remove tags **only** when the row’s values match the moved-out values (no broad disjunct-wide removal). Use stored row values to recompute tags deterministically.

### 8.4 Updates must remove removed_tags and possibly delete rows

Remove tags, add new tags, delete row only when tag set becomes empty.

---

# Phase 9 — Tests (must add)

## 9.1 Unit tests: DNF extraction

- Nested AND/OR forms (e.g. `x IN subq1 AND (y IN subq2 OR z IN subq3)`).
- Assert correct disjunct expansion and sublink membership.

## 9.2 Unit tests: Materializer (AND-combined)

- Insert row with composite tag A.
- Move-out only one sublink value; row remains if other disjunct/tag still applies.
- Move-out remaining sublink; row deleted.

## 9.3 Integration test: no invalidation on OR/AND

- Move-in/out events for nested OR/AND shapes; assert consumer does not stop_and_clean.

## 9.4 OR + non‑sublink predicates (new scope)

- Ensure tags are conditional on non‑sublink predicates for disjuncts like `x IN subq OR status='active'`.
- Add unit tests for predicate extraction and runtime tagging.
- Add integration test to verify move‑out removes rows when only subquery disjunct was satisfied.

---

# Phase 10 — Rollout safety toggles

- Keep behind existing `tagged_subqueries` flag unless explicitly removed.

---

# Final checklist (AI agent execution order)

1. Remove single-subquery validation (Phase 1)
2. Implement full DNF extraction (Phase 2)
3. Update tag_structure representation (Phase 3)
4. Add dependency-aware hashing + move-out patterns (Phase 4)
5. Fix move_in_where_clause with AND-forcing constraint (Phase 5)
6. Make Shape.fill_move_tags conditional using extra_refs (Phase 6)
7. Remove OR invalidation (Phase 7)
8. Upgrade Materializer to UPSERT + value-aware multi-tag removal (Phase 8)
9. Add tests (Phase 9)
10. Confirm rollout flag usage (Phase 10)

---

## Notes / Assumptions (updated)

- Full DNF support is required.
- AND-combined subqueries are supported now.
- OR shapes mixing subqueries and non‑subquery predicates are in scope and must be correct.
- TypeScript client is no longer supported; no client changes are required.
