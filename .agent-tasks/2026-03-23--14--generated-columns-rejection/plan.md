# Implementation Plan

## Goal
Fix the publication upgrade path: when Electric owns a publication on PG18+ that doesn't have `publish_generated_columns = stored`, automatically alter it to add that setting.

## Steps

### Step 1: Update `check_publication_status!` to return PG version info
In `configuration.ex`, modify the query to also return whether PG >= 18 as a separate field (`pg_supports_generated_columns?`). This lets callers distinguish "PG < 18 so feature unavailable" from "PG >= 18 but publication not configured".

### Step 2: Add publication upgrade logic in the configurator
In `configurator.ex`'s `check_publication_status/1`, after getting the status:
- If `pg_supports_generated_columns?` is true AND `publishes_generated_columns?` is false AND `can_alter_publication?` is true
- Execute `ALTER PUBLICATION <name> SET (publish_generated_columns = stored)`
- Update the status to reflect the change
- Log the upgrade

### Step 3: Add `alter_publication_set_generated_columns` to Configuration
Add a new function in `configuration.ex` to execute the ALTER PUBLICATION statement.

### Step 4: Add tests
- Test that `check_publication_status!` returns the new field
- Test that the configurator upgrades the publication when conditions are met
- Test that it doesn't attempt upgrade when PG < 18 or can't alter

### Step 5: Create changeset entry

---

## Review discussion

### Q: Why not just try the ALTER and catch the error?
A: Cleaner to check version first. Avoids noisy error logs and maintains separation of concerns. The version info is already queried in `check_publication_status!`.

### Q: Should we handle the case where ALTER fails due to permissions?
A: The `can_alter_publication?` check already covers this - if Electric doesn't own the publication, it won't attempt the ALTER. The existing error path (`publication_missing_generated_columns`) provides clear guidance.

### Q: Should this be in connection_setup.ex instead?
A: No, the configurator is the right place because:
1. It already handles publication status checks periodically
2. It has the right error handling infrastructure
3. Connection setup only runs once on startup, but publication status can change
