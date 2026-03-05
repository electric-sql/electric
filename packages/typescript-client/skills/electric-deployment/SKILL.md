---
name: electric-deployment
description: >
  Deploy Electric via Docker, Docker Compose, or Electric Cloud. Covers
  DATABASE_URL (direct connection, not pooler), ELECTRIC_SECRET (required
  since v1.x), ELECTRIC_INSECURE for dev, wal_level=logical,
  max_replication_slots, ELECTRIC_STORAGE_DIR persistence,
  ELECTRIC_POOLED_DATABASE_URL for pooled queries, IPv6 with
  ELECTRIC_DATABASE_USE_IPV6, Kubernetes readiness probes (200 vs 202),
  replication slot cleanup, and Postgres v14+ requirements. Load when
  deploying Electric or configuring Postgres for logical replication.
type: lifecycle
library: electric
library_version: '1.5.10'
sources:
  - 'electric-sql/electric:website/docs/guides/deployment.md'
  - 'electric-sql/electric:packages/sync-service/dev/postgres.conf'
  - 'electric-sql/electric:packages/sync-service/CHANGELOG.md'
---

# Electric — Deployment

## Setup

### Postgres configuration

```conf
# postgresql.conf
wal_level = logical
max_replication_slots = 10
```

### Docker Compose

```yaml
name: 'electric-backend'
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: electric
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
    ports: ['54321:5432']
    volumes: ['./postgres.conf:/etc/postgresql/postgresql.conf:ro']
    tmpfs: ['/var/lib/postgresql/data', '/tmp']
    command: ['postgres', '-c', 'config_file=/etc/postgresql/postgresql.conf']

  electric:
    image: electricsql/electric:latest
    environment:
      DATABASE_URL: postgresql://postgres:password@postgres:5432/electric?sslmode=disable
      ELECTRIC_SECRET: ${ELECTRIC_SECRET}
    ports: ['3000:3000']
    volumes: ['electric_data:/var/lib/electric']
    depends_on: ['postgres']

volumes:
  electric_data:
```

### Electric Cloud

```sh
npx @electric-sql/start my-app
pnpm claim && pnpm deploy
```

## Core Patterns

### Environment variables

| Variable                       | Required   | Description                                   |
| ------------------------------ | ---------- | --------------------------------------------- |
| `DATABASE_URL`                 | Yes        | Direct Postgres connection (not pooler)       |
| `ELECTRIC_SECRET`              | Yes (prod) | API authentication secret                     |
| `ELECTRIC_INSECURE`            | Dev only   | Set `true` to skip secret requirement         |
| `ELECTRIC_STORAGE_DIR`         | No         | Persistent shape cache directory              |
| `ELECTRIC_POOLED_DATABASE_URL` | No         | Pooled connection for non-replication queries |
| `ELECTRIC_DATABASE_USE_IPV6`   | No         | Set `true` for IPv6 Postgres connections      |

### Kubernetes health checks

```yaml
livenessProbe:
  httpGet:
    path: /v1/health
    port: 3000
readinessProbe:
  exec:
    command: ['curl', '-sf', 'http://localhost:3000/v1/health']
  # Use exec, not httpGet — 202 means "alive but not ready"
  # Only 200 means fully ready for traffic
```

### Replication slot cleanup

```sql
-- When stopping Electric for extended periods:
SELECT pg_drop_replication_slot('electric_slot_default');

-- Prevent unbounded WAL growth:
ALTER SYSTEM SET max_slot_wal_keep_size = '10GB';
SELECT pg_reload_conf();
```

## Common Mistakes

### CRITICAL Not setting wal_level to logical

Wrong:

```conf
# postgresql.conf (default)
wal_level = replica
```

Correct:

```conf
wal_level = logical
max_replication_slots = 10
```

Electric requires logical replication. The default `wal_level = replica` does not support it. Requires Postgres restart after change.

Source: `packages/sync-service/dev/postgres.conf`

### CRITICAL Running without ELECTRIC_SECRET in production

Wrong:

```sh
docker run electricsql/electric \
  -e DATABASE_URL=postgres://user:pass@host/db
```

Correct:

```sh
docker run electricsql/electric \
  -e DATABASE_URL=postgres://user:pass@host/db \
  -e ELECTRIC_SECRET=my-secret-key
```

Since v1.x, `ELECTRIC_SECRET` is required. Without it, Electric refuses to start unless `ELECTRIC_INSECURE=true` is set (dev only).

Source: `packages/sync-service/CHANGELOG.md:832-834`

### MEDIUM Using ephemeral storage for ELECTRIC_STORAGE_DIR

Wrong:

```yaml
electric:
  image: electricsql/electric:latest
  # No volume — shape cache lost on restart
```

Correct:

```yaml
electric:
  image: electricsql/electric:latest
  volumes: ['electric_data:/var/lib/electric']
```

Electric caches shape logs on disk. Ephemeral storage causes full re-sync on every container restart.

Source: `website/docs/guides/deployment.md:133-157`

### MEDIUM Using deprecated ELECTRIC_QUERY_DATABASE_URL

Wrong:

```sh
ELECTRIC_QUERY_DATABASE_URL=postgres://user:pass@pooler:6432/db
```

Correct:

```sh
ELECTRIC_POOLED_DATABASE_URL=postgres://user:pass@pooler:6432/db
```

Renamed from `ELECTRIC_QUERY_DATABASE_URL` to `ELECTRIC_POOLED_DATABASE_URL` in v1.3.x. The old name may stop working in future versions.

Source: `packages/sync-service/CHANGELOG.md:415`

See also: electric-proxy-auth/SKILL.md — Production requires proxy with ELECTRIC_SECRET.
See also: electric-postgres-security/SKILL.md — Deployment requires correct Postgres configuration.
See also: electric-debugging/SKILL.md — Many sync issues stem from deployment configuration.

## Version

Targets Electric sync service v1.x.
