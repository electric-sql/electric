# Investigation: Connection Limit Exhaustion & Publication Privilege Error with Pooled Connections

## Bug Report Summary

A user on Crunchy Bridge reported two issues:
1. Electric exhausting database connection limits (resolved by adding pooled connection URL)
2. After adding pooled connection with a different database user, Electric reports:
   "Database table 'public.conversations' is missing from the publication ... and Electric lacks privileges to add it"

## Root Cause

Electric uses the **pooled connection** (admin pool) for publication management, **not** the replication connection. When the pooled connection uses a different user than the one that created the publication, the ownership check fails.

### The Chain of Events

1. **Publication creation** happens on the **replication connection** (superuser, `DATABASE_URL`).
   - `packages/sync-service/lib/electric/postgres/replication_client/connection_setup.ex:144-155`

2. **Publication management** (adding/dropping tables) runs on the **admin pool**, which uses `ELECTRIC_POOLED_DATABASE_URL`.
   - Wired in `packages/sync-service/lib/electric/core_supervisor.ex:57`:
     ```elixir
     db_pool: Electric.Connection.Manager.admin_pool(stack_id)
     ```

3. The **ownership check** in `packages/sync-service/lib/electric/postgres/configuration.ex:52`:
   ```sql
   pg_get_userbyid(p.pubowner) = current_role as can_alter_publication
   ```
   Returns `false` because the publication owner (superuser) != the pooled connection user (app user).

4. `can_update_publication?` returns `false` → Electric reports "lacks privileges" error.
   - `packages/sync-service/lib/electric/replication/publication_manager/configurator.ex:330-335`

### Why This Breaks on Crunchy Bridge

- Superusers **cannot** connect through PgBouncer (Crunchy Bridge restriction)
- PgBouncer only allows application-level users
- The application user doesn't own the publication

## Key Code Locations

| File | Lines | Purpose |
|------|-------|---------|
| `config/runtime.exs` | 43-78 | Env var parsing for pooled URL |
| `connection/manager.ex` | 375-434 | Admin pool uses pooled connection opts |
| `core_supervisor.ex` | 52-59 | Publication manager wired to admin pool |
| `postgres/configuration.ex` | 46-75 | `check_publication_status!` ownership check |
| `publication_manager/configurator.ex` | 110-123 | Status check updates `can_alter_publication?` |
| `publication_manager/configurator.ex` | 140, 185, 330-335 | Gate on `can_update_publication?` |
| `publication_manager/configurator.ex` | 355-375 | Error message generation |
| `replication_client/connection_setup.ex` | 144-155 | Publication creation on replication connection |

## Proposed Fixes

### Option A: Improve `can_alter_publication` SQL check

Current check only tests exact ownership. A more robust check:
```sql
pg_get_userbyid(p.pubowner) = current_role
  OR pg_has_role(current_role, p.pubowner, 'USAGE')
  OR (SELECT rolsuper FROM pg_roles WHERE rolname = current_role)
AS can_alter_publication
```
Note: This alone won't fix Crunchy Bridge since the app user genuinely isn't in the superuser role.

### Option B: Use replication connection for publication management

Route publication management through the replication connection which always has correct privileges.
Larger architectural change since it uses `Postgrex.ReplicationConnection`.

### Option C: Documentation improvements

Update docs to explain permission requirements for `ELECTRIC_POOLED_DATABASE_URL` user:
- Crunchy Bridge integration page needs pooled connection guidance
- Deployment guide needs permission implications documented
- Permissions guide needs pooled connection user scenario

### Option D: Graceful fallback

When `can_alter_publication?` is false on pooled connection, fall back to replication connection.

## Recommended Approach

Combine Option A + C:
1. Improve the ownership check for role membership and superuser status
2. Update documentation for the pooled connection user scenario

## Immediate User Workarounds

1. Transfer publication ownership: `ALTER PUBLICATION <pub_name> OWNER TO u_XXX;`
2. Grant the app user membership in the owner's role
3. Use `ELECTRIC_MANUAL_TABLE_PUBLISHING=true` and pre-add tables via DBA

## Documentation Gaps

1. **Crunchy Bridge page** (`website/docs/integrations/crunchy.md`): No mention of `ELECTRIC_POOLED_DATABASE_URL` or PgBouncer constraints
2. **Deployment guide**: Mentions pooled URL but not permission implications
3. **Permissions guide**: Thorough but doesn't address pooled connection user scenario
