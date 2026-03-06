---
name: electric-postgres-security
description: >
  Pre-deploy security checklist for Postgres with Electric. Checks REPLICATION
  role, SELECT grants, CREATE on database, table ownership, REPLICA IDENTITY
  FULL on all synced tables, publication management (auto vs manual with
  ELECTRIC_MANUAL_TABLE_PUBLISHING), connection pooler exclusion for
  DATABASE_URL (use direct connection), and ELECTRIC_POOLED_DATABASE_URL
  for pooled queries. Load before deploying Electric to production or when
  diagnosing Postgres permission errors.
type: security
library: electric
library_version: '1.5.10'
requires:
  - electric-proxy-auth
sources:
  - 'electric-sql/electric:website/docs/guides/postgres-permissions.md'
  - 'electric-sql/electric:website/docs/guides/troubleshooting.md'
  - 'electric-sql/electric:website/docs/guides/deployment.md'
---

This skill builds on electric-proxy-auth. Read it first for proxy security patterns.

# Electric — Postgres Security Checklist

Run through each section before deploying Electric to production.

## User Permission Checks

### Check: Electric user has REPLICATION role

Expected:

```sql
SELECT rolreplication FROM pg_roles WHERE rolname = 'electric_user';
-- Should return: true
```

Fail condition: `rolreplication = false` or user does not exist.
Fix: `ALTER ROLE electric_user WITH REPLICATION;`

### Check: Electric user has SELECT on synced tables

Expected:

```sql
SELECT has_table_privilege('electric_user', 'todos', 'SELECT');
-- Should return: true
```

Fail condition: Returns `false`.
Fix: `GRANT SELECT ON todos TO electric_user;` or `GRANT SELECT ON ALL TABLES IN SCHEMA public TO electric_user;`

### Check: Electric user has CREATE on database

Expected:

```sql
SELECT has_database_privilege('electric_user', current_database(), 'CREATE');
-- Should return: true (unless using manual publishing mode)
```

Fail condition: Returns `false` and not using `ELECTRIC_MANUAL_TABLE_PUBLISHING=true`.
Fix: `GRANT CREATE ON DATABASE mydb TO electric_user;`

## Table Configuration Checks

### Check: REPLICA IDENTITY FULL on all synced tables

Expected:

```sql
SELECT relname, relreplident
FROM pg_class
WHERE relname IN ('todos', 'users')
  AND relreplident = 'f';  -- 'f' = FULL
```

Fail condition: `relreplident` is `'d'` (default) or `'n'` (nothing).
Fix: `ALTER TABLE todos REPLICA IDENTITY FULL;`

### Check: Tables are in the Electric publication

Expected:

```sql
SELECT tablename FROM pg_publication_tables
WHERE pubname = 'electric_publication_default';
```

Fail condition: Synced tables missing from the list.
Fix (manual mode): `ALTER PUBLICATION electric_publication_default ADD TABLE todos;`

## Connection Checks

### Check: DATABASE_URL uses direct connection (not pooler)

Expected:

```
DATABASE_URL=postgres://user:pass@db-host:5432/mydb
```

Fail condition: URL points to a connection pooler (e.g., PgBouncer on port 6432, Supabase pooler).
Fix: Use direct Postgres connection for `DATABASE_URL`. Set `ELECTRIC_POOLED_DATABASE_URL` separately for pooled queries.

### Check: wal_level is set to logical

Expected:

```sql
SHOW wal_level;
-- Should return: logical
```

Fail condition: Returns `replica` or `minimal`.
Fix: Set `wal_level = logical` in `postgresql.conf` and restart Postgres.

## Common Security Mistakes

### CRITICAL Using connection pooler for DATABASE_URL

Wrong:

```sh
DATABASE_URL=postgres://user:pass@pooler.example.com:6432/mydb
```

Correct:

```sh
DATABASE_URL=postgres://user:pass@db.example.com:5432/mydb
ELECTRIC_POOLED_DATABASE_URL=postgres://user:pass@pooler.example.com:6432/mydb
```

Connection poolers (except PgBouncer 1.23+) do not support logical replication. Electric must connect directly to Postgres for its replication slot.

Source: `website/docs/guides/deployment.md:91`

### HIGH Missing REPLICA IDENTITY FULL on tables

Wrong:

```sql
CREATE TABLE todos (id UUID PRIMARY KEY, text TEXT);
-- Replica identity defaults to 'default' (PK only)
```

Correct:

```sql
CREATE TABLE todos (id UUID PRIMARY KEY, text TEXT);
ALTER TABLE todos REPLICA IDENTITY FULL;
```

Without `REPLICA IDENTITY FULL`, Electric cannot stream the full row on updates and deletes. Updates may be missing non-PK columns.

Source: `website/docs/guides/troubleshooting.md:373`

### HIGH Electric user without REPLICATION role

Wrong:

```sql
CREATE USER electric_user WITH PASSWORD 'secret';
```

Correct:

```sql
CREATE USER electric_user WITH PASSWORD 'secret' REPLICATION;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO electric_user;
```

Electric uses logical replication and requires the `REPLICATION` role on the database user.

Source: `website/docs/guides/postgres-permissions.md`

## Pre-Deploy Summary

- [ ] Electric user has `REPLICATION` role
- [ ] Electric user has `SELECT` on all synced tables
- [ ] Electric user has `CREATE` on database (or manual publishing configured)
- [ ] All synced tables have `REPLICA IDENTITY FULL`
- [ ] All synced tables are in the Electric publication
- [ ] `DATABASE_URL` uses direct Postgres connection (not pooler)
- [ ] `wal_level = logical` in Postgres config
- [ ] `ELECTRIC_SECRET` is set (not using `ELECTRIC_INSECURE=true`)
- [ ] Secrets are injected server-side only (never in client bundle)

See also: electric-proxy-auth/SKILL.md — Proxy injects secrets that Postgres security enforces.
See also: electric-deployment/SKILL.md — Deployment requires correct Postgres configuration.

## Version

Targets Electric sync service v1.x.
