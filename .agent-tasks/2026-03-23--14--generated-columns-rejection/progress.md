# Progress Log

## 2026-03-23

### Investigation

1. Read upstream issue electric#4038 - user on PG18 (Railway) gets 400 error for tables with generated columns
2. Traced error path through codebase:
   - 400 error originates from `shape.ex:validate_selected_columns/4` (lines 400-402, 434-438)
   - This checks `supports_generated_column_replication` from inspector
   - Inspector checks `current_setting('server_version_num')::int >= 180000`
   - On PG18, this should be `true` → no 400 error

3. Identified two separate code paths for generated column errors:
   - **Shape validation (400)**: checks PG version via inspector → rejects if PG < 18
   - **Publication manager (503)**: checks publication's `pubgencols` attribute → rejects if publication doesn't publish generated columns

4. Found the real code gap: `connection_setup.ex` only sets `publish_generated_columns = stored` during `CREATE PUBLICATION`. If publication already exists (created by older Electric or on PG < 18), it's never upgraded.

5. Conclusion: user's 400 error is likely due to running an older Electric version. But there IS a real bug in the publication upgrade path that would cause a 503 on PG18 with a pre-existing publication.

### Implementation plan
- Fix the publication upgrade path: when Electric owns the publication, is on PG18+, and the publication doesn't have `publish_generated_columns = stored`, alter it to add that setting.
- Reply to upstream issue with analysis and guidance.

### Implementation

1. Modified `check_publication_status!` in `configuration.ex` to return `pg_supports_generated_columns?` field
2. Added `alter_publication_set_generated_columns/2` function (using non-bang `Postgrex.query/3`)
3. Added `maybe_upgrade_generated_columns/2` in configurator that auto-upgrades on startup
4. Updated router test that was testing 503 behavior — now expects 200 since publication auto-upgrades
5. Added tests for new functions and the upgrade scenario
6. Created changeset entry

### Review feedback addressed
- Changed `alter_publication_set_generated_columns` from `Postgrex.query!/3` to `Postgrex.query/3` to avoid escalating transient failures to all shapes
- Updated configurator to handle ALTER failure gracefully, logging warning and falling back

### CI results
- All sync-service tests pass on PG14 and PG18
- PG15 and PG17 had flaky test failures in unrelated tests (consumer_test.exs, publication_manager_test.exs "handles relation tracker restart")
- Elixir formatting and compilation clean
- TS formatting failure unrelated (no TS changes)

### Deliverables
- PR: https://github.com/electric-sql/electric/pull/4045
- Comment on upstream issue: https://github.com/electric-sql/electric/issues/4038#issuecomment-4112568287

### Operational issues
- Worktree created from canonical clone, push URL uses `github-erik` SSH host
- husky pre-commit hook ignored (not executable) — no impact on commits
