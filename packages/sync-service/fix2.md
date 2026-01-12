# Fix Plan: Full DNF + AND-Combined Subqueries

## Goals
- Full DNF support is required (nested OR/AND forms must be handled, not rejected).
- AND-combined subqueries are supported now.
- TypeScript client is no longer supported; remove client-related work from scope.

## Issues to Fix
1) DNF extraction only flattens top-level OR; it does not distribute AND over OR.
2) Composite move-out handling removes tags too broadly (may delete rows that should remain).
3) Tests are missing for AND-combined move-outs, UPSERT tag merging, and no-invalidation flow.

## Plan

### 1) Implement full DNF distribution in SubqueryMoves
- Add a DNF builder that converts the WHERE AST into a list of disjuncts by distributing AND over OR.
- Make `extract_dnf_structure/1` use the DNF builder instead of only flattening top-level OR.
- Ensure disjuncts preserve non-sublink predicates, and still extract sublink patterns + comparison expressions.

### 2) Fix composite move-out correctness in Materializer
- Replace the conservative tag removal for composite patterns with value-aware removal:
  - For each composite pattern, compute candidate disjunct tags for affected rows by re-evaluating the disjunct on stored row values.
  - Only remove tags whose sublink values actually match the moved-out values.
- Use the materialized `index` row values to compute the tag hashes deterministically (same logic as in `Shape.fill_move_tags`).
- Keep the tag_indices inverse index consistent with row_tags for composite removals.

### 3) Align tag hashing for disjuncts
- Ensure disjunct tag hashing is centralized and reused by:
  - `Shape.fill_move_tags/4` (server stream tagging)
  - Materializer composite move-out computation
- Keep tag formats stable (`d{disjunct_index}:{hash}`) and deterministic.

### 4) Remove TS client references
- Delete or update any docs/tests/plans that mention TS client support.

### 5) Add tests
- Unit: DNF distribution
  - Nested AND/OR cases (e.g. `x IN subq1 AND (y IN subq2 OR z IN subq3)`).
  - Assert disjunct count and sublink membership per disjunct.
- Unit: Materializer composite move-out
  - Two-sublink disjunct where only one sublink value moves out; row should remain if other disjunct still satisfied.
  - Verify correct tag removal based on row values.
- Integration: no invalidation on OR/AND subqueries
  - Shape with nested OR/AND, move-in/out events, assert consumer continues without stop/cleanup.

## Deliverables
- Correct DNF extraction and composite move-out handling.
- Updated tests covering nested DNF and AND-combined subqueries.
- Updated `plan.md` reflecting full DNF + AND support and removal of TS client scope.
