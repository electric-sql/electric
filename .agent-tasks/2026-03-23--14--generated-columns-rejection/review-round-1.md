# Code Review -- Round 1

**Commit reviewed:** b2fd0cc00
**Reviewer:** Code review agent
**Date:** 2026-03-23

## Summary

This change fixes a real upgrade-path bug: when a user moves from PG < 18 to PG18+ with an existing Electric-owned publication, the publication lacks `publish_generated_columns = stored`, causing 503 errors for shapes involving stored generated columns. The fix detects this condition and automatically issues `ALTER PUBLICATION ... SET (publish_generated_columns = stored)`.

Overall, this is a well-structured, minimal, and focused fix. The implementation aligns closely with the plan. Below are the findings.

---

## What Was Done Well

- **Minimal and focused.** The change touches exactly the files it needs to: the configuration module (query + new function), the configurator (upgrade logic), and corresponding tests. No unrelated changes.
- **Correct placement.** Putting the upgrade logic in the configurator rather than connection setup is the right call -- the configurator already checks publication status periodically and has the error-handling infrastructure.
- **Pattern matching for control flow.** The `maybe_upgrade_generated_columns/2` function uses Elixir pattern matching idiomatically -- the three-field match clause is clear about when upgrade happens, and the fallthrough clause is a clean no-op.
- **SQL injection prevention.** The `alter_publication_set_generated_columns/2` function uses `Utils.quote_name/1` which properly escapes double quotes in identifiers, consistent with how publication names are handled elsewhere in the codebase (e.g., `exec_alter_publication_for_table`).
- **Logging.** The `Logger.notice` call provides appropriate visibility for an automatic schema-level change.

---

## Issues

### Important (should fix)

**1. No error handling in `maybe_upgrade_generated_columns/2` for ALTER failure**

The function calls `Configuration.alter_publication_set_generated_columns/2` which uses `Postgrex.query!/3` (note the bang). If the ALTER fails for any reason (e.g., transient connection issue, unexpected permission problem despite the ownership check), this will raise an exception that propagates up through `check_publication_status/1`.

The caller wraps this in `Configuration.run_handling_db_connection_errors/1`, so connection errors will be caught. However, non-connection Postgrex errors (e.g., a `Postgrex.Error` from an unexpected SQL error) would crash the configurator process.

Consider either:
- Wrapping the call in a try/rescue and logging a warning on failure (then returning status unchanged, letting the existing `publication_missing_generated_columns` error path handle it downstream), or
- Using `Postgrex.query/3` (non-bang) and pattern matching on the result.

This is an edge case but aligns with defensive programming for DDL operations.

**2. Test in `publication_manager_test.exs` line 384 does not quote the publication name**

```elixir
"ALTER PUBLICATION #{ctx.publication_name} SET (publish_generated_columns = 'none')"
```

The publication name is interpolated without quoting. While test publication names are unlikely to contain special characters, this is inconsistent with the production code which uses `Utils.quote_name/1`. The same issue exists in the `configuration_test.exs` test at line 338. For consistency and to avoid subtle test failures if publication naming conventions change, use `Utils.quote_name/1` or at minimum wrap in double quotes.

### Suggestions (nice to have)

**3. Tests silently pass on PG < 18**

All three new tests use `if pg_version >= 180_000 do ... end` with no `else` clause. On PG < 18, these tests execute zero assertions and pass silently. This is a known pattern in the codebase (the existing `check_publication_status!` test at line 277 does the same), so it is consistent. However, consider adding a comment like `# Test is a no-op on PG < 18` or using `@tag :pg18` to make skip behavior explicit.

**4. The `pg_supports_generated_columns?` field leaks implementation detail into the type**

The `publication_status` type now includes `pg_supports_generated_columns?`, but this field is only consumed by `maybe_upgrade_generated_columns/2` in the configurator. No other caller needs to know whether PG supports generated columns -- they only care about `publishes_generated_columns?`. After the upgrade logic runs, the field is no longer meaningful.

This is a minor coupling concern. An alternative would be to have `check_publication_status!` return a separate `{:needs_upgrade, status}` tuple, or to handle the upgrade entirely within the configuration module. That said, the current approach is simple and readable, so this is just something to be aware of for future maintenance.

**5. Upgrade runs on every publication status check**

`maybe_upgrade_generated_columns/2` is called from `check_publication_status/1`, which runs periodically (based on `publication_refresh_period`). After the first successful upgrade, subsequent checks will see `publishes_generated_columns?: true` and the pattern match will fall through to the no-op clause. So this is fine in practice -- no repeated ALTERs. Just calling it out to confirm the logic is sound (it is).

---

## Plan Alignment

The implementation follows the plan from `plan.md` faithfully:

| Plan Step | Status | Notes |
|-----------|--------|-------|
| Step 1: Update `check_publication_status!` with PG version info | Done | New `pg_supports_generated_columns?` field added |
| Step 2: Add upgrade logic in configurator | Done | `maybe_upgrade_generated_columns/2` with correct conditions |
| Step 3: Add `alter_publication_set_generated_columns` | Done | Uses `Utils.quote_name` properly |
| Step 4: Add tests | Done | Three tests covering status field, alter function, and integration |
| Step 5: Create changeset | Done (separate commit) | |

No deviations from the plan.

---

## Verdict

The fix is correct, minimal, and well-tested for the target scenario. The main actionable item is adding error handling around the ALTER PUBLICATION call (Issue #1) to prevent a potential process crash on unexpected SQL errors. The test quoting issue (#2) is a minor hygiene item. Everything else is solid work.
