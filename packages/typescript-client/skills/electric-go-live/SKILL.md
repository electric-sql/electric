---
name: electric-go-live
description: >
  Production readiness checklist — security audit, deployment verification,
  WAL monitoring, replication slot health, ELECTRIC_SECRET, proxy verification,
  performance, SQLite storage, network FS exclusive mode
type: sub-skill
library: '@electric-sql/client'
library_version: '1.5.8'
sources:
  - 'electric:website/docs/guides/troubleshooting.md'
  - 'electric:AGENTS.md'
---

# Electric Go-Live Checklist

Production readiness verification before launch.

## Setup

Run through each section before deploying to production.

## Core Patterns

### Security Checklist

- [ ] Electric behind authenticated proxy (never direct client access)
- [ ] `ELECTRIC_SECRET` set (not `ELECTRIC_INSECURE=true`)
- [ ] Server defines shapes (client cannot control `table` or `where`)
- [ ] `Vary` header set on proxy responses (`Authorization` or `Cookie`)
- [ ] No secrets in client bundle (`ELECTRIC_SECRET`, `SOURCE_SECRET`)
- [ ] User scoping on every proxy route (`where user_id = $1`)

### Database Checklist

- [ ] `wal_level=logical` confirmed
- [ ] Electric user has `REPLICATION` role
- [ ] Tables have `REPLICA IDENTITY FULL`
- [ ] `max_slot_wal_keep_size` set (e.g., `10GB`) to prevent unbounded WAL growth

### Monitoring

```sql
-- Check replication slot health
SELECT slot_name, active, wal_status,
  pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained_wal
FROM pg_replication_slots
WHERE slot_name LIKE 'electric%';
```

Key metrics to watch:

- `electric.postgres.replication.slot_retained_wal_size`
- `electric.postgres.replication.slot_confirmed_flush_lsn_lag`
- `wal_status` should be `reserved` (not `extended` or `unreserved`)

### Performance Checklist

- [ ] HTTP/2 proxy configured (Caddy or nginx) — fixes 6-connection limit
- [ ] SSE proxy buffering disabled (`flush_interval -1` / `proxy_buffering off`)
- [ ] Shape columns limited to what's needed (skip large text/blob columns)
- [ ] Custom type parsers configured for timestamps, JSON, arrays

### Infrastructure

- [ ] Electric service health check endpoint monitored (`/health`)
- [ ] WAL retention alerts configured
- [ ] Backup strategy includes replication slot awareness

## Common Mistakes

### [HIGH] WAL growth without monitoring

Wrong:

```sql
-- No monitoring, default unlimited WAL retention
-- Disk fills silently over days/weeks
```

Correct:

```sql
ALTER SYSTEM SET max_slot_wal_keep_size = '10GB';
SELECT pg_reload_conf();
```

Active replication slots prevent WAL cleanup. Without `max_slot_wal_keep_size`,
disk fills silently. If Electric disconnects, its slot holds WAL indefinitely.

Source: website/docs/guides/troubleshooting.md

### [MEDIUM] Using SQLite storage on network FS without exclusive mode

Wrong:

```yaml
environment:
  DATABASE_URL: postgres://...
  ELECTRIC_STORAGE_DIR: /efs/electric # AWS EFS without exclusive mode
```

Correct:

```yaml
environment:
  DATABASE_URL: postgres://...
  ELECTRIC_STORAGE_DIR: /efs/electric
  ELECTRIC_SHAPE_DB_EXCLUSIVE_MODE: true # Required for network FS
```

Network file systems (AWS EFS) need `ELECTRIC_SHAPE_DB_EXCLUSIVE_MODE=true`
for SQLite-based shape storage to work correctly.

Source: sync-service CHANGELOG.md

### [HIGH] Deploying without HTTP/2 proxy

Wrong:

```yaml
# Direct Electric exposure on port 3000, HTTP/1.1
ports: ['3000:3000']
```

Correct:

```yaml
# Caddy reverse proxy with HTTP/2
services:
  caddy:
    image: caddy:alpine
    ports: ['443:443']
    volumes: ['./Caddyfile:/etc/caddy/Caddyfile']
```

HTTP/1.1's 6-connection browser limit causes visible delays with multiple shapes.
Production deployments should always use HTTP/2 via a reverse proxy.

Source: website/docs/guides/troubleshooting.md

## References

- [Troubleshooting Guide](https://electric-sql.com/docs/guides/troubleshooting)
- [Configuration Reference](https://electric-sql.com/docs/api/config)
- [Postgres Permissions](https://electric-sql.com/docs/guides/postgres-permissions)
