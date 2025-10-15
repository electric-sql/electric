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

PlanetScale has several unique characteristics that require special attention:

1. **Logical replication** - Not enabled by default, must configure cluster parameters
2. **Connection limits** - Default of 25 is too low for Electric's pool of 20
3. **Failover requirements** - Replication slots must support failover

For general PostgreSQL user and permission setup, see the [PostgreSQL Permissions guide](/docs/guides/postgres-permissions).

## Deploy Postgres

[Sign up to PlanetScale](https://planetscale.com) and [create a Postgres database](https://planetscale.com/docs/postgres/tutorials/planetscale-postgres-quickstart).

### Enable Logical Replication

Logical replication **may not be enabled** on your cluster. Verify and configure as needed. See the [PlanetScale Logical Replication guide](https://planetscale.com/docs/postgres/integrations/logical-cdc) for detailed background.

**Verify current configuration:**
```sql
SHOW wal_level; -- Should return 'logical'
```

**If not enabled, configure in PlanetScale Console:**
1. Go to your database → [**Settings → Cluster configuration → Parameters**](https://planetscale.com/docs/postgres/settings)
2. Set these parameters:
   - `wal_level` = `logical`
   - `max_replication_slots` = `10` (or higher)
   - `max_wal_senders` = `10` (or higher)
   - `max_slot_wal_keep_size` = `4096` (4GB minimum)
   - `sync_replication_slots` = `on` (for failover support)
   - `hot_standby_feedback` = `on` (for failover support)

3. Apply changes (may require cluster restart)

> [!Important] Failover Requirement
> PlanetScale requires replication slots to support failover. Electric creates failover-enabled slots automatically, but your cluster must have `sync_replication_slots = on` configured.

### Increase Connection Limits

Small PlanetScale clusters may start with a low `max_connections` limit. Electric uses **20 connections** for its connection pool by default (configurable via [`ELECTRIC_DB_POOL_SIZE`](/docs/api/config#electric-db-pool-size)).

> [!Warning] Connection Limit Issue
> With a low connection limit, you may have limited headroom remaining for:
> - Your application
> - Database migrations
> - Admin tools
> - Connection poolers (Cloudflare, etc.)
>
> **Recommendation:** Plan connection capacity for your expected concurrent database work. A good rule of thumb is **≥ 3× Electric's pool size** to ensure adequate headroom (e.g., if Electric uses 20 connections, set `max_connections` to at least 60).

To increase connection limits in PlanetScale:
1. Go to your database → [**Settings → Cluster configuration → Parameters**](https://planetscale.com/docs/postgres/settings)
2. Find `max_connections` parameter
3. Increase based on your expected concurrent work (Electric pool size + application + admin tools + buffer)

Alternatively, reduce Electric's pool size if you have limited connections:
```shell
ELECTRIC_DB_POOL_SIZE=10
```

## Create Replication User

Follow the [PostgreSQL Permissions guide](/docs/guides/postgres-permissions) to set up the Electric user with proper permissions.

> [!Important] PlanetScale-Specific Note
> PlanetScale's default `postgres` role includes the `REPLICATION` attribute. You can use it directly, or create a dedicated replication role for least-privilege access per your organization's security policy.

## Connect Electric

Get your [connection string from PlanetScale](https://planetscale.com/docs/postgres/connection-strings):

> [!Important] Connection String Requirements
> - Use the **direct connection** (port 5432), not PgBouncer (port 6432)
> - Include `sslmode=require` (PlanetScale requires SSL/TLS)
> - See [PlanetScale connection strings documentation](https://planetscale.com/docs/postgres/connection-strings)

```shell
docker run -it \
    -e "DATABASE_URL=postgresql://electric:secure_password@aws-us-east-1.connect.psdb.cloud:5432/your_db?sslmode=require" \
    -p 3000:3000 \
    electricsql/electric:latest
```

> [!Note] FOR ALL TABLES Limitation
> Some sources suggest PlanetScale doesn't support `CREATE PUBLICATION ... FOR ALL TABLES`. If you encounter this issue, explicitly list tables in your publication. See [Manual Publication Management](/docs/guides/postgres-permissions#manual-configuration-steps) in the PostgreSQL Permissions guide.

## Troubleshooting

For general PostgreSQL permission and configuration errors, see the [PostgreSQL Permissions guide](/docs/guides/postgres-permissions#troubleshooting).

### PlanetScale-Specific Issues

#### Error: "too many connections"

**Cause:** Electric's connection pool plus other connections exceed PlanetScale's limit.

**Solution:** [Increase PlanetScale's max_connections](#increase-connection-limits) to 50+ or reduce `ELECTRIC_DB_POOL_SIZE`.

#### Error: "replication slot does not support failover"

**Cause:** PlanetScale requires failover-enabled replication slots.

**Solution:** Ensure your cluster has `sync_replication_slots = on` and `hot_standby_feedback = on` configured. Electric creates failover-enabled slots automatically.

## Best Practices

1. **Plan connection capacity** - Set max_connections to at least 3x Electric's pool size
2. **Monitor connections** - Track connection usage in PlanetScale dashboard
3. **Use direct connections** - Port 5432 (direct), not 6432 (PgBouncer) for replication
4. **Enable monitoring** - Track WAL usage and replication lag in PlanetScale

For general PostgreSQL and Electric best practices, see:
- [PostgreSQL Permissions guide](/docs/guides/postgres-permissions)
- [Deployment guide](/docs/guides/deployment)

## Additional Resources

**PlanetScale Documentation:**
- [PlanetScale for Postgres Quickstart](https://planetscale.com/docs/postgres/tutorials/planetscale-postgres-quickstart)
- [Logical Replication and CDC](https://planetscale.com/docs/postgres/integrations/logical-cdc)
- [Database Settings and Parameters](https://planetscale.com/docs/postgres/settings)
- [Connection Strings](https://planetscale.com/docs/postgres/connection-strings)
- [High Availability with CDC](https://planetscale.com/blog/postgres-ha-with-cdc)

**Electric Documentation:**
- [PostgreSQL Permissions Guide](/docs/guides/postgres-permissions)
- [Electric Deployment Guide](/docs/guides/deployment)
