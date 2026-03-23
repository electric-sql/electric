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
