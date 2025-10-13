---
outline: deep
title: PlanetScale - Integrations
description: >-
  How to use Electric with PlanetScale Postgres.
image: /img/integrations/electric-planetscale.jpg
---

# PlanetScale

[PlanetScale](https://planetscale.com) provides managed Postgres hosting with high-availability clusters.

## Electric and PlanetScale

You can use Electric with [PlanetScale for Postgres](https://planetscale.com/docs/postgres).

> [!Tip] Need context?
> See the [Deployment guide](/docs/guides/deployment) for more details.

## Setup Overview

Setting up Electric with PlanetScale requires attention to three key areas:

1. **Connection limits** - PlanetScale's default limits may be too low
2. **Replication role** - Standard PlanetScale roles don't include replication privileges
3. **Table ownership** - Electric needs to own tables to manage snapshots

## Deploy Postgres

[Sign up to PlanetScale](https://planetscale.com) and create a Postgres database.

### Enable Logical Replication

PlanetScale Postgres requires logical replication to be enabled. Configure the following settings:

```sql
-- Check current WAL level
SHOW wal_level; -- Should be 'logical'

-- If not already set, configure these parameters:
-- wal_level = logical
-- max_replication_slots >= 1
-- max_wal_senders >= 2
```

> [!Important] Failover Configuration
> PlanetScale requires replication slots to be created with `failover = true` for production use. Electric will create the replication slot automatically, but ensure your cluster has `sync_replication_slots = on` enabled.

### Increase Connection Limits

PlanetScale's default connection limit is **25 connections**, but Electric needs **20 connections** for its connection pool by default (configurable via [`ELECTRIC_DB_POOL_SIZE`](/docs/api/config#electric-db-pool-size)).

> [!Warning] Connection Limit Issue
> With only 25 total connections, you'll have just 5 connections remaining for:
> - Your application
> - Database migrations
> - Admin tools
> - Connection poolers (Cloudflare, etc.)
>
> **Recommendation:** Increase your connection limit to at least **50 connections** or higher depending on your needs.

To increase connection limits in PlanetScale:

1. Go to your database settings
2. Find the "Connection Limits" or "max_connections" setting
3. Increase to 50 or more

Alternatively, reduce Electric's pool size if you have limited connections:

```shell
ELECTRIC_DB_POOL_SIZE=10
```

## Create Replication User

PlanetScale's default user roles don't include the `REPLICATION` privilege required by Electric. You must create a custom role.

### Step 1: Create Role with REPLICATION

Connect to your PlanetScale database as a superuser and run:

```sql
-- Create user with REPLICATION privilege
CREATE ROLE electric WITH LOGIN PASSWORD 'secure_password' REPLICATION;

-- Grant database privileges
GRANT CONNECT ON DATABASE postgres TO electric;
GRANT USAGE, CREATE ON SCHEMA public TO electric;
GRANT CREATE ON DATABASE postgres TO electric;

-- Grant table privileges
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO electric;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO electric;
```

### Step 2: Transfer Table Ownership

Electric requires table ownership to create initial snapshots and set `REPLICA IDENTITY FULL`.

> [!Important] Same User for Migrations
> The Electric user should be the same user you use for database migrations. If Electric doesn't own the tables, it cannot create snapshots.

Transfer ownership of all tables:

```sql
-- Transfer ownership of all existing tables
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE 'ALTER TABLE public.' || quote_ident(r.tablename) || ' OWNER TO electric';
  END LOOP;
END$$;

-- Ensure future tables are also owned by electric
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON TABLES TO electric;
```

Alternatively, if you can't transfer ownership, see the [Manual Publication Management](#manual-publication-management) section below.

## Connect Electric

Get your connection string from PlanetScale. Make sure to:
- Use the **direct connection** (port 5432), not the PgBouncer pooled connection (port 6432)
- Include `sslmode=require` (PlanetScale requires SSL/TLS)

```shell
docker run -it \
    -e "DATABASE_URL=postgresql://electric:secure_password@aws-us-east-1.connect.psdb.cloud:5432/your_db?sslmode=require" \
    -e "ELECTRIC_DB_POOL_SIZE=20" \
    -p 3000:3000 \
    electricsql/electric:latest
```

## Manual Publication Management

If you cannot transfer table ownership to the Electric user, you can use manual publication management.

### Step 1: Create Publication

```sql
-- Create publication for specific tables
CREATE PUBLICATION electric_publication_default FOR TABLE
  public.users,
  public.posts,
  public.comments;

-- Set replica identity on each table
ALTER TABLE public.users REPLICA IDENTITY FULL;
ALTER TABLE public.posts REPLICA IDENTITY FULL;
ALTER TABLE public.comments REPLICA IDENTITY FULL;

-- Transfer publication ownership to Electric user
ALTER PUBLICATION electric_publication_default OWNER TO electric;
```

> [!Note] FOR ALL TABLES Limitation
> Some sources suggest PlanetScale doesn't support `CREATE PUBLICATION ... FOR ALL TABLES`. If you encounter issues, explicitly list tables as shown above.

### Step 2: Grant Minimal Permissions

```sql
-- Electric only needs SELECT for manual publication management
GRANT SELECT ON public.users TO electric;
GRANT SELECT ON public.posts TO electric;
GRANT SELECT ON public.comments TO electric;
```

### Step 3: Configure Electric

Enable manual table publishing mode:

```shell
docker run -it \
    -e "DATABASE_URL=postgresql://electric:secure_password@aws-us-east-1.connect.psdb.cloud:5432/your_db?sslmode=require" \
    -e "ELECTRIC_MANUAL_TABLE_PUBLISHING=true" \
    -p 3000:3000 \
    electricsql/electric:latest
```

## Troubleshooting

### Error: "too many connections"

**Cause:** Electric's connection pool (default 20) plus other connections exceed PlanetScale's limit (default 25).

**Solution:** Either increase PlanetScale's max_connections or reduce Electric's pool size:

```shell
ELECTRIC_DB_POOL_SIZE=10
```

### Error: "permission denied for schema public"

**Cause:** The Electric user doesn't have proper schema privileges.

**Solution:** Grant schema privileges:

```sql
GRANT USAGE, CREATE ON SCHEMA public TO electric;
```

### Error: "must be owner of table"

**Cause:** Electric needs table ownership to create snapshots.

**Solution:** Either:
1. Transfer table ownership to the Electric user (recommended)
2. Use manual publication management mode

See [Create Replication User](#create-replication-user) above.

### Error: "replication slot does not support failover"

**Cause:** PlanetScale requires failover-enabled replication slots.

**Solution:** Ensure your cluster has `sync_replication_slots = on` configured. Electric will create failover-enabled slots automatically.

## Best Practices

1. **Use dedicated user** - Create a separate `electric` role rather than using your default user
2. **Match migration user** - Use the same user for Electric and database migrations
3. **Monitor connections** - Track connection usage to avoid hitting limits
4. **Plan for growth** - Set max_connections higher than current needs
5. **Enable monitoring** - Use PlanetScale's monitoring to track WAL usage and replication lag

## Additional Resources

- [PlanetScale Postgres Documentation](https://planetscale.com/docs/postgres)
- [PlanetScale Logical Replication Guide](https://planetscale.com/docs/postgres/integrations/logical-cdc)
- [PostgreSQL Permissions Guide](/docs/guides/postgres-permissions)
- [Electric Deployment Guide](/docs/guides/deployment)
