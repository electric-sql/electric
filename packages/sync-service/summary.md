# Bug-Fixing Context: Arbitrary Boolean Expressions with Subqueries

This document provides the key context needed to debug issues in the "arbitrary boolean expressions with subqueries" implementation. For full details, see:

- **RFC**: `../../docs/rfcs/arbitrary-boolean-expressions-with-subqueries.md`
- **Original implementation plan**: `./IMPLEMENTATION_PLAN.md` (14 phases)
- **Exclusion clause bug & fix**: `./PLAN_UPDATE.md`
- **Exclusion clause implementation details**: `./IMP_PLAN_UPDATE.md`

---

## What This Feature Does

Previously, Electric only supported single `column IN (SELECT ...)` subqueries in shape WHERE clauses. This feature extends support to arbitrary boolean expressions: OR, AND, NOT, and multiple subqueries. For example:

```sql
WHERE project_id IN (SELECT id FROM projects WHERE active)
   OR assigned_to IN (SELECT id FROM users WHERE admin)
```

The WHERE clause is decomposed into **Disjunctive Normal Form (DNF)** — a disjunction (OR) of conjunctions (AND) of literals. Each unique atomic condition gets a **position** index. The system tracks per-row, per-position state to determine visibility.

---

## Core Concepts

### DNF Positions
Every atomic condition in the WHERE clause gets a unique integer position (0-indexed). For `WHERE (x IN sq1 AND status = 'active') OR y IN sq2`:
- Position 0: `x IN sq1` (subquery)
- Position 1: `status = 'active'` (non-subquery)
- Position 2: `y IN sq2` (subquery)
- Disjunct 0 = positions {0, 1}, Disjunct 1 = position {2}

### active_conditions
A `[boolean]` array, one entry per DNF position, sent to clients with every row. Tells the client which conditions are satisfied for that row. Negated positions store the **effective** value (negation already applied).

### Tags (slash-delimited per-disjunct)
Wire format: `["hash_x/hash_status/", "//hash_y"]`. One string per disjunct, positions separated by `/`. Empty segments = non-participating positions. Used in change structs, JSON headers, and on the wire to clients.

### condition_hashes (per-position map)
Internal format: `%{0 => "hash_x", 1 => "hash_status", 2 => "hash_y"}`. One hash per DNF position. Stored in binary move-in snapshot files for `moved_out_tags` filtering. **Not** the same as wire tags — these are stored separately from the JSON.

### DnfContext
Struct in `lib/electric/shapes/consumer/dnf_context.ex` — holds the cached DNF decomposition, position-to-dependency maps, and negated position tracking. Built once at consumer startup from the Shape. All downstream code should use this cached decomposition, never re-decompose.

---

## Key Architecture & Data Flow

### Layer ordering
Dependency shapes (layer 0) process transactions before the outer shape (layer 1). Materializers in layer 0 `send` `{:materializer_changes, handle, events}` to the outer consumer. Due to FIFO mailbox ordering, the consumer processes all `materializer_changes` **before** its own `do_handle_txn` for the same transaction.

### Move-in flow
1. Materializer detects value added to dependency → sends `materializer_changes` with `move_in` values
2. Consumer's `handle_info({:materializer_changes, ...})` receives it
3. `MoveHandling.process_move_ins` looks up affected DNF positions via `DnfContext`
4. For positive positions: builds WHERE clause via `SubqueryMoves.move_in_where_clause` and queries Postgres
5. For negated positions: broadcasts deactivation (move-out)

### Move-out flow
Inverse of move-in. Positive positions broadcast deactivation; negated positions query Postgres for newly matching rows.

### Exclusion clauses (the PLAN_UPDATE fix)
When multiple disjuncts exist, move-in queries include `AND NOT (...)` clauses to avoid returning rows that will be claimed by another disjunct's move-in. **The original plan used live subqueries for exclusion, which is broken** — see `PLAN_UPDATE.md` for the full explanation.

**Fix**: Use **parameter-based exclusion** (`= ANY($values)`) with materialized state. The materializer retains `prev_value_counts` (pre-transaction state). The consumer tracks `seen_deps` — which dependencies' `materializer_changes` it has already processed for the current transaction:

- **Seen dependency** → use **current** materialized values (its move-in already started)
- **Unseen dependency** → use **pre-transaction** materialized values (avoids false exclusion)

`seen_deps` is reset at the start of each `do_handle_txn`.

---

## Key Files

| File | Role |
|------|------|
| `lib/electric/replication/eval/decomposer.ex` | DNF decomposition of WHERE clause ASTs |
| `lib/electric/replication/eval/sql_generator.ex` | AST → SQL conversion (for active_conditions SELECT and exclusion clauses) |
| `lib/electric/shapes/consumer/dnf_context.ex` | Cached DNF state (decomposition, position maps, negated positions) |
| `lib/electric/shapes/shape/subquery_moves.ex` | Move-in WHERE clause generation including DNF-aware exclusion clauses |
| `lib/electric/shapes/shape.ex` | `fill_tag_structure` (multi-disjunct tag patterns), `fill_move_tags` (slash-delimited output) |
| `lib/electric/shapes/consumer/move_handling.ex` | Move-in/out orchestration, position routing, negation inversion, builds exclusion context |
| `lib/electric/shapes/consumer/materializer.ex` | Tracks `value_counts` and `prev_value_counts`, serves `get_link_values`/`get_prev_link_values` |
| `lib/electric/shapes/consumer/state.ex` | Holds `dnf_context`, `seen_deps` tracking |
| `lib/electric/shapes/consumer.ex` | Wires `materializer_changes` → marks seen deps, resets seen_deps in `do_handle_txn` |
| `lib/electric/shapes/where_clause.ex` | `compute_active_conditions`, `evaluate_dnf` |
| `lib/electric/shapes/consumer/change_handling.ex` | Computes active_conditions per change, evaluates DNF for inclusion |
| `lib/electric/shapes/querying.ex` | SQL for snapshots/move-ins, `build_active_conditions_select`, `make_condition_hashes_select` |
| `lib/electric/log_items.ex` | Formats messages with `active_conditions` in headers, tags passed through as-is |
| `lib/electric/shapes/consumer/move_ins.ex` | `moved_out_tags` — position-aware `%{name => %{position => MapSet}}` |
| `lib/electric/shape_cache/pure_file_storage.ex` | Binary snapshot read/write with condition_hashes, position-aware `should_skip_for_moved_out?` |
| `packages/elixir-client/lib/electric/client/tag_tracker.ex` | Client-side DNF evaluation, synthetic deletes, slash-delimited tag parsing |

---

## Common Bug Categories & What to Check

### 1. Rows missing (not delivered to client)
- **Exclusion clause bug**: Are both disjuncts excluding a row? Check `seen_deps` logic in `move_handling.ex` → `build_exclusion_context`. Verify that unseen deps use `get_prev_link_values` (pre-txn state) and seen deps use `get_link_values` (current state).
- **moved_out_tags false positive**: Is `should_skip_for_moved_out?` in storage incorrectly filtering a row? Check that condition_hashes (per-position) are being compared, not wire-format tags.
- **Wrong disjunct in WHERE**: Is `build_dnf_move_in_where` using the full original WHERE instead of the triggering disjunct's conditions?

### 2. Duplicate rows delivered
- **Exclusion clause not firing**: Check `build_dnf_exclusion_clauses` — it should only exclude disjuncts that do NOT contain the trigger position. If exclusion is missing entirely, both move-ins return the same row.
- **Tag mismatch**: Verify that Postgres-generated hashes (from `make_condition_hashes_select` and `make_tags`) match Elixir-generated hashes (from `fill_move_tags`). They both must use the same `namespace_value` + MD5 formula with identical column value formatting.

### 3. Wrong active_conditions values
- **Sublink index resolution**: If two subqueries reference the same column (e.g., `parent_id IN sq1 OR parent_id IN sq2`), `extract_sublink_index` must be used to distinguish them via AST node, NOT column-name matching. Column-name matching always resolves to the first dependency.
- **Negation not applied**: `compute_active_conditions` in `where_clause.ex` must apply `not` for negated positions. The decomposer stores un-negated ASTs with `negated: true`.
- **Non-subquery conditions returning true**: In `build_active_conditions_select` (querying.ex), non-subquery positions must use `SqlGenerator.to_sql(subexpr.ast)` — a hardcoded `"true"` is wrong for OR shapes.

### 4. Synthetic deletes not generated / generated incorrectly
- **Client tag parsing**: `removed_tags` arrive in the same slash-delimited format as `tags`. The client must split them on `/` before comparison. If compared as raw strings against individual hashes, they'll never match.
- **DNF evaluation**: Client's `row_visible?` must evaluate OR-of-ANDs over disjunct positions. A row is visible if ANY disjunct has ALL its positions active.
- **Orphaned tag_to_keys entries**: When a row is deleted or all its positions become inactive, ensure the `tag_to_keys` index is cleaned up. Stale entries cause phantom synthetic deletes when a move-out broadcast matches a key that is no longer tracked.

### 5. Position instability across restarts
- Position assignment in the decomposer must be deterministic (sorted by canonical AST representation). If positions shift, clients holding cached `active_conditions` will misinterpret them.

### 6. Single-dependency shapes regressing
- Single-disjunct shapes should take the fast path in most places (`length(disjuncts) == 1`). The `when not Shape.has_dependencies(shape)` guard in `change_handling.ex` already skips DNF code for shapes without dependencies.

---

## Invariants That Must Hold

1. **No re-decomposition within consumer lifetime** — always use `DnfContext`'s cached decomposition
2. **`seen_deps` reset at start of every `do_handle_txn`** — stale seen_deps from a previous transaction will use wrong materialized state
3. **`prev_value_counts` NOT saved during startup stream reads** — only saved before applying runtime transaction changes
4. **condition_hashes stored separately from JSON in binary snapshot files** — filtering must use per-position hashes, not wire-format tags
5. **Tags and condition_hashes both computed from the same column values** using the same hashing formula — Postgres-side and Elixir-side must produce identical results
6. **`extract_sublink_index` used everywhere** a sublink's dependency index is needed — never resolve by column name
7. **Negated positions invert move semantics**: move-in to subquery + negated position = deactivation; move-out from subquery + negated position = activation
