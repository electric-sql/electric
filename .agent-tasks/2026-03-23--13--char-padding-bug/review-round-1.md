# Code Review: char(n) padding fix — Round 1

Reviewed commit: `c89137e1e`
Branch: `char-padding-bug`

---

## Summary

The implementation correctly follows the plan. The single-function change to `pg_cast_column_to_text/1` in `querying.ex` covers all four call paths (value serialization, PK key building, and both tag-hashing paths in `make_tags`), which matches the plan's stated scope. The test is present and exercises the core scenario. Overall this is a sound fix, but there are several issues that should be addressed before merging.

---

## What Was Done Well

- The fix is minimal and surgical: one private function change covers all affected code paths without requiring changes to the Shape struct, its serialization, or any other module.
- The NULL guard in the CASE expression is present and correct, consistent with the plan's analysis that `concat(NULL, '') = ''` would silently drop NULLs if the NULL branch were omitted.
- The comment in the implementation is accurate and explains the `concat()` rationale clearly.
- The commit message is well-written: it references the issue number and explains the "why".
- The new blank line between `pg_cast_column_to_text/1` and `pg_escape_string_for_json/1` is missing — the closing `end` and the next `defp` are on adjacent lines. This is a minor formatting nit but inconsistent with the rest of the file.

---

## Issues

### Critical

None.

---

### Important

**1. NULL handling is redundant and creates a subtle double-evaluation risk in `pg_namespace_value_sql`**

`pg_cast_column_to_text/1` now returns an expression that evaluates `"col"` twice — once in the NULL check and once in the chosen branch:

```sql
CASE WHEN "col" IS NULL THEN NULL::text
     WHEN pg_typeof("col") = 'character'::regtype THEN concat("col", '')
     ELSE "col"::text END
```

This is then passed into `pg_namespace_value_sql/1`, which wraps it in another `CASE ... IS NULL` check:

```sql
CASE WHEN <above_expr> IS NULL
     THEN 'NULL'
     ELSE 'v:' || <above_expr> END
```

Because `<above_expr>` is not a column reference but a multi-branch CASE expression, PostgreSQL must evaluate it twice for the non-NULL branch (once for the IS NULL check, once for the concatenation). This is not a correctness problem — PostgreSQL's optimizer cannot in general prove the two evaluations are identical so it will run the inner CASE twice per row per tag column. For the value path through `escape_column_value` the wrapping happens inside `pg_coalesce_json_string` after `to_json()`, so the same double-evaluation applies there too.

This is a pre-existing structural issue in the code (the old `"col"::text` also got evaluated twice by the outer coalesce/namespace wrappers), but the new CASE expression is materially larger, making it worth noting. It is not a correctness problem and the performance impact is low for typical workloads, but if this is on a hot path (large initial snapshots) it is worth documenting.

The NULL-producing branch in `pg_cast_column_to_text` itself (`WHEN "col" IS NULL THEN NULL::text`) is also unnecessary: if you remove it entirely, the ELSE branch (`"col"::text`) already returns NULL when `"col"` is NULL because `NULL::text` is NULL. The NULL guard was added because the plan noted `concat(NULL, '') = ''`, but that scenario is already excluded by the second WHEN clause: if the column IS NULL, `pg_typeof("col") = 'character'::regtype` is still true for a bpchar column (pg_typeof of a NULL bpchar is still `character`), meaning the original NULL guard is actually load-bearing and cannot be removed without reintroducing the bug.

Conclusion: the NULL branch is correct and required. The double-evaluation of the CASE expression is a minor inefficiency worth a comment but not a blocker.

**2. `char(1)` / bare `char` (no length) — not tested, but correctly handled**

PostgreSQL `char` (without length) is `char(1)`, and its internal type is still `bpchar`. The `pg_typeof()` comparison `= 'character'::regtype` matches all bpchar types regardless of length, including `char(1)` and `char`. The fix is correct for these variants but no test covers them. A test with a `CHAR(1)` column and a bare `CHAR` column would give higher confidence.

**3. Arrays of `char(n)` — not handled, not tested**

A column declared as `char(n)[]` (bpchar array) has `pg_typeof()` returning `character[]` (or `bpchar[]`), not `character`. The current CASE expression checks for `= 'character'::regtype` which will not match an array type, so an array of bpchar will fall through to the `::text` cast path, which trims padding from each element.

The replication path for array types sends element values with padding preserved (WAL sends the raw storage bytes), so this is the same category of inconsistency as the scalar bug, just applied to array elements.

Whether arrays of `char(n)` are a supported use-case in practice is unclear from this codebase, but the plan does not mention arrays of char(n) at all. This gap should be acknowledged, either with a test confirming the current (broken) behavior and a follow-up issue, or with a fix.

---

### Suggestions

**4. Test: only `stream_initial_data` is covered**

The plan called out testing `query_move_in` and `query_subset` as well. Neither has a char(n)-specific test. `query_move_in` is exercised by the existing subquery tests (which use integer columns), but a char(n) PK used as a subquery join column would be a useful regression test given the `join_primary_keys` path is also fixed by the same function.

**5. Test: NULL value in a `char(n)` column**

The new test only inserts a non-NULL value. A row with a NULL `char(n)` column should be tested to confirm the NULL guard produces a JSON `null` rather than an empty string. The existing "works with null values" test (line 175) uses `TEXT`, not `char(n)`.

**6. Test: `char(n)` column as a PK in a table without an explicit PK constraint**

The new test uses `CHAR(8) PRIMARY KEY`. The `join_primary_keys` path is also used for pk-less tables where all columns are treated as PKs. A table with no primary key but a `char(n)` column is not tested.

**7. Missing blank line in the implementation**

The closing `end` of `pg_cast_column_to_text/1` is immediately followed by `defp pg_escape_string_for_json(str)` with no blank line separator. All other adjacent `defp` pairs in this file have a blank line between them.

---

## Plan Alignment

All planned changes are implemented. There are no deviations from the plan's fix strategy. The plan explicitly noted that arrays of char(n) and `char(1)` were not discussed; the implementation is consistent with the plan's documented scope.

The plan's Step 3 ("Run tests") cannot be assessed from static review alone. Given the structural change adds a CASE expression to every column cast, it would be worth confirming the existing test suite passes in full (not just the new test).

---

## Required Actions Before Merge

1. Add a test for a NULL value in a `char(n)` column to confirm no regression on the NULL guard.
2. Add a test for `char(1)` / bare `CHAR` to confirm the `pg_typeof` comparison matches these variants.
3. Document or file a follow-up issue for `char(n)[]` array columns — the current fix does not cover them and the behavior is inconsistent with the replication path in the same way the original bug was.
4. Fix the missing blank line after the `end` of `pg_cast_column_to_text/1` (formatting).
