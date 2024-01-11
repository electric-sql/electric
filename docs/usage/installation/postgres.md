---
title: Postgres
description: >-
  With logical replication enabled.
sidebar_position: 30
---

ElectricSQL requires a [PostgreSQL](https://www.postgresql.org/download) database. Postgres is the world's most advanced open source relational database.

## Compatibility

ElectricSQL works with standard Postgres [version >= 14.0](https://www.postgresql.org/support/versioning/) with [logical&nbsp;replication](https://www.postgresql.org/docs/current/logical-replication.html) enabled. You don't need to install any extensions or run any unsafe code.

:::info
Specifically, right now, ElectricSQL works with a single database in a single Postgres installation with tables in the public schema.
:::

## Hosting

Many managed hosting providers support logical replication (either out of the box or as an option to enable). This includes, for example:

- [AWS RDS](https://repost.aws/knowledge-center/rds-postgresql-use-logical-replication) and [Aurora](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/AuroraPostgreSQL.Replication.Logical.html) (including Aurora Serverless v2)
- [Crunchy Data](https://www.crunchydata.com) who have a free tier and logical replication enabled by default
- [Supabase](https://supabase.com/) who provide managed Postgres hosting with logical replication and a suite of other backend-as-a-service tools, including auth and edge functions.

See the <DocPageLink path="deployment" /> section for more information about compatible Postgres hosts. There's also a [long list of Postgres hosting providers here](https://www.postgresql.org/support/professional_hosting/).

### Self-host / run locally

You can run your own Postgres anywhere you like. See the [Postgres Server Administration](https://www.postgresql.org/docs/current/admin.html) docs for more information.

#### Docker

For example, to run using Docker:

```shell
docker run \
    -e "POSTGRES_PASSWORD=..." \
    postgres -c "wal_level=logical"
```

#### Homebrew

To run locally using Homebrew, first install and start the service:

```shell
brew install postgresql
brew services start postgresql
```

Enable logical replication:

```sql
psql -U postgres \
    -c 'ALTER SYSTEM SET wal_level = logical'
brew services restart postgresql
```

Verify the wal_level is logical:

```shell
psql -U postgres -c 'show wal_level'
```

## Database user

The [Electric sync service](./service.md) connects to Postgres as a database user. This user needs certain permissions. The exact permissions required depend on how you run the [Sync service](./service.md) and are documented on <DocPageLink path="api/service#database-user-permissions" />.
