# Fix Plan: OR + subquery move-in correctness, TS tag cleanup, and tests

Goal: close correctness gaps identified in the last commit by ensuring move-in queries are constrained for any OR-with-subquery, fix TS tag deletion semantics, and add missing tests (including an integration test in router_test.exs).

## 1) Server: Always add forced AND for OR-with-subquery

Problem:
- move_in_where_clause/3 currently adds the forced AND only when there are multiple dependencies. For cases like `x IN (subq) OR status = 'active'` (single dependency), the query can pull in unrelated rows and generate incorrect tags.

Plan:
- In `packages/sync-service/lib/electric/shapes/shape/subquery_moves.ex`, replace the `has_multiple_deps` check with an `or_with_subquery?` check that mirrors the AST logic in `packages/sync-service/lib/electric/shapes/consumer/state.ex`.
- Apply forced AND whenever the WHERE clause has an OR subtree that includes a sublink ref.
- Keep behavior unchanged for purely AND / no-OR cases.

Notes:
- Reuse AST walk logic (Walker.reduce! + subtree_has_sublink?) locally in SubqueryMoves to avoid cross-module coupling.
- Ensure this applies for both single-column and composite-key branches.

## 2) TS client: delete rows when all tags removed (update path)

Problem:
- In the update path, `#removeTags` can delete the key from `#keyTags` when tags become empty, but the caller only deletes rows if `keyTagsAfterUpdate` exists and has size 0. When it is deleted, the row remains erroneously.

Plan:
- In `packages/typescript-client/src/shape.ts`, update both update branches (full + changes_only) to treat `!keyTagsAfterUpdate` as “no tags remain” and delete the row when there are no new tags to add.
- Keep existing behavior for cases where new tags are added or tags still exist.

## 3) Tests: fill gaps from plan + new OR-with-subquery move-in test

### 3.1 Unit: SubqueryMoves

File: `packages/sync-service/test/electric/shapes/shape/subquery_moves_test.exs`

Add test that verifies forced AND for OR-with-subquery even when there is only one subquery dependency, e.g.:
- WHERE `x IN (SELECT ...) OR status = 'active'`
- Expect query shape: `(replaced_query) AND forced_clause` and params unchanged.

### 3.2 Unit: Materializer

Add a new test module for tag/row behavior:
- Insert row with tagA
- UPSERT same row with tagB
- move-out tagA -> row remains
- move-out tagB -> row deleted

Likely location:
- `packages/sync-service/test/electric/shapes/consumer/materializer_test.exs` (or adjacent test directory; follow existing layout)

### 3.3 Integration: no must-refetch on move-in/out

Add/extend integration test to assert:
- move-in produces inserts
- move-out produces event
- consumer does not invalidate

Variations:
- OR in outer query
- OR in subquery
- OR in subquery of subquery

TODO: add these integration tests to `packages/sync-service/test/electric/shapes/router_test.exs`.

## 4) Verify

- Run unit tests for SubqueryMoves and Materializer.
- Run the router_test.exs integration test.
- Spot-check that move-in queries now include forced AND for any OR-with-subquery.

