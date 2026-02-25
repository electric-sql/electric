---
name: deploying-electric
description: >
  Deployment options — Electric Cloud (npx @electric-sql/start), Docker Compose,
  self-hosted, DATABASE_URL, ELECTRIC_SECRET, ELECTRIC_INSECURE, wal_level,
  REPLICATION role, env var configuration, reverse proxy, SSL
type: sub-skill
library: '@electric-sql/client'
library_version: '1.5.8'
sources:
  - 'electric:website/docs/guides/installation.md'
  - 'electric:website/docs/guides/postgres-permissions.md'
  - 'electric:AGENTS.md'
---

# Deploying Electric

Three deployment options: Electric Cloud, Docker Compose, or self-hosted.

## Setup

### Postgres Requirements (all deployments)

- PostgreSQL 14+
- `wal_level=logical` (not the default `replica`)
- User with `REPLICATION` role
- Tables must have `REPLICA IDENTITY FULL`

```sql
-- Enable logical replication (requires restart)
ALTER SYSTEM SET wal_level = 'logical';

-- Create Electric user
CREATE ROLE electric_user WITH LOGIN PASSWORD 'secret' REPLICATION;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO electric_user;
```

## Core Patterns

### Electric Cloud

```bash
npx @electric-sql/start my-app
pnpm claim && pnpm deploy
```

Environment for proxy:

```bash
ELECTRIC_URL=https://api.electric-sql.cloud
ELECTRIC_SOURCE_ID=your-source-id
ELECTRIC_SECRET=your-secret
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
    image: electricsql/electric:canary
    environment:
      DATABASE_URL: postgresql://postgres:password@postgres:5432/electric?sslmode=disable
      ELECTRIC_INSECURE: true # dev only — use ELECTRIC_SECRET in production
    ports: ['3000:3000']
    depends_on: ['postgres']
```

### Self-Hosted

```bash
docker run -e DATABASE_URL=postgres://user:pass@host:5432/db \
  -e ELECTRIC_SECRET=your-production-secret \
  -p 3000:3000 electricsql/electric
```

## Common Mistakes

### [CRITICAL] Postgres without logical replication enabled

Wrong:

```bash
# Default Postgres — wal_level=replica
docker run postgres:16
```

Correct:

```bash
# postgres.conf must include:
# wal_level = logical
docker run -v ./postgres.conf:/etc/postgresql/postgresql.conf:ro \
  postgres:16 -c config_file=/etc/postgresql/postgresql.conf
```

`wal_level=logical` is required. The default `wal_level=replica` causes an unclear
connection failure when Electric tries to create a replication slot.

Source: website/docs/guides/installation.md

### [CRITICAL] Database user missing REPLICATION role

Wrong:

```sql
CREATE ROLE electric_user WITH LOGIN PASSWORD 'secret';
```

Correct:

```sql
CREATE ROLE electric_user WITH LOGIN PASSWORD 'secret' REPLICATION;
```

Electric creates a logical replication slot. Without the `REPLICATION` role, slot
creation fails with a permissions error.

Source: website/docs/guides/postgres-permissions.md

### [HIGH] Not setting ELECTRIC_SECRET in production

Wrong:

```yaml
environment:
  DATABASE_URL: postgres://...
  ELECTRIC_INSECURE: true # "I'll add auth later"
```

Correct:

```yaml
environment:
  DATABASE_URL: postgres://...
  ELECTRIC_SECRET: your-strong-secret-here
```

`ELECTRIC_SECRET` is required since v1.0. Without it or `ELECTRIC_INSECURE=true`,
the service refuses to start. `ELECTRIC_INSECURE` must never reach production.

Source: sync-service CHANGELOG.md v1.0.0

## Tension: CDN cacheability vs real-time freshness

Electric's HTTP responses include cache headers enabling CDN distribution. But
proxy/CDN misconfigurations can cause stale data. Preserve Electric's
`cache-control` and `etag` headers — don't override them with aggressive caching.

Cross-reference: `electric-http-api`

## References

- [Installation Guide](https://electric-sql.com/docs/guides/installation)
- [Postgres Permissions](https://electric-sql.com/docs/guides/postgres-permissions)
- [Configuration Reference](https://electric-sql.com/docs/api/config)
- Reference: `deploying-electric/references/electric-cloud.md`
- Reference: `deploying-electric/references/docker.md`
- Reference: `deploying-electric/references/self-hosted.md`
