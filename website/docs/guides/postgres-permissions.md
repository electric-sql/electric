---
title: PostgreSQL Permissions - Guide
description: >-
  How to create and configure PostgreSQL users with the necessary permissions for Electric.
outline: [2, 3]
---

# PostgreSQL Permissions

This guide explains how to create PostgreSQL users with the necessary permissions for Electric to work correctly. Electric requires specific database privileges to enable logical replication and manage publications.

## Quick Start

Choose the approach that fits your needs:

**For Development:**
Use the default `postgres` superuser. Electric will automatically configure everything.

```shell
DATABASE_URL=postgresql://postgres:your_password@localhost:5432/your_database
```

This is often fine for production too. See [For Development](#for-development) below for details.

**For Production (Automatic Mode):**
Create a dedicated Electric user with automatic table configuration.
→ See [Automatic Mode Setup](#automatic-mode-setup)

**For Production (Manual Mode / Least-Privilege):**
Pre-configure tables manually and use minimal Electric privileges.
→ See [Manual Mode Setup](#manual-mode-setup)

## Core Permission Requirements

Electric needs the following PostgreSQL permissions:

| Permission | Purpose | Required For |
|------------|---------|--------------|
| `REPLICATION` | Enable logical replication streaming | Creating replication slots and consuming the WAL |
| `CREATE` on database | Create publications | Automatic publication management |
| `SELECT` on tables | Read table data | Initial shape snapshots |
| Table ownership | Set replica identity | Configuring `REPLICA IDENTITY FULL` |
| Publication ownership | Modify publications | Adding/removing tables from publication; you must also own each table you add to the publication |

## Automatic vs Manual Publication Management

Electric can operate in two modes:

### 1. Automatic Mode (Recommended)

Electric automatically creates the publication and adds tables to it as shapes are requested. Requires `CREATE` privilege on the database and either table ownership or pre-configured `REPLICA IDENTITY FULL` on tables.

### 2. Manual Mode

You manually manage the publication and Electric only validates the configuration. Enable this with [`ELECTRIC_MANUAL_TABLE_PUBLISHING=true`](/docs/api/config#electric-manual-table-publishing). Requires only `REPLICATION` and `SELECT` privileges, but you must pre-configure the publication and `REPLICA IDENTITY FULL`.

**When to use manual mode:**
- When Electric's database user doesn't have `CREATE` privileges
- When you want explicit control over which tables are replicated
- In security-sensitive environments with strict privilege separation

## Setup Examples

### For Development

Use the default `postgres` superuser or another superuser role:

```shell
DATABASE_URL=postgresql://postgres:your_password@localhost:5432/your_database
```

Electric will automatically create publications, configure `REPLICA IDENTITY FULL`, and manage everything for you. This is often fine for production too, especially for smaller deployments.

### Automatic Mode Setup

Create a dedicated Electric user with automatic table configuration. Electric will create publications and add tables as shapes are requested.

```sql
-- Create the Electric user with REPLICATION
CREATE ROLE electric_user WITH LOGIN PASSWORD 'secure_password' REPLICATION;

-- Grant database-level privileges
GRANT CONNECT ON DATABASE mydb TO electric_user;
GRANT USAGE, CREATE ON SCHEMA public TO electric_user;
GRANT CREATE ON DATABASE mydb TO electric_user;

-- Grant privileges on tables
-- For all tables:
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO electric_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO electric_user;

-- For specific tables only:
-- GRANT SELECT, INSERT, UPDATE, DELETE ON public.users, public.posts TO electric_user;

-- Grant privileges on sequences (for generated IDs)
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO electric_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON SEQUENCES TO electric_user;
```

**Handling REPLICA IDENTITY FULL - Choose one option:**

**Option A: Pre-configure as DBA (Recommended)**

Have your DBA or a superuser set `REPLICA IDENTITY FULL` before Electric runs, keeping table ownership with your application:

```sql
-- As superuser/DBA, set REPLICA IDENTITY on tables that will be synced
ALTER TABLE public.users REPLICA IDENTITY FULL;
ALTER TABLE public.posts REPLICA IDENTITY FULL;
ALTER TABLE public.comments REPLICA IDENTITY FULL;
```

**Option B: Transfer Ownership to Electric**

Transfer table ownership so Electric can manage `REPLICA IDENTITY` automatically:

```sql
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE 'ALTER TABLE public.' || quote_ident(r.tablename) || ' OWNER TO electric_user';
  END LOOP;
END$$;
```

> [!Warning] Ownership Transfer
> Transferring table ownership removes ownership from the previous owner. If you prefer to keep table ownership with your application or DBA role, use Option A instead.

Then connect Electric:

```shell
DATABASE_URL=postgresql://electric_user:secure_password@localhost:5432/mydb
```

### Manual Mode Setup

For environments with strict security requirements, you can use manual publication management to minimize Electric's privileges.

```sql
-- Create the Electric user with REPLICATION (but minimal other privileges)
CREATE ROLE electric_user WITH LOGIN PASSWORD 'secure_password' REPLICATION;

-- Grant only connection and usage privileges
GRANT CONNECT ON DATABASE mydb TO electric_user;
GRANT USAGE ON SCHEMA public TO electric_user;

-- Grant SELECT only on specific tables
GRANT SELECT ON public.users TO electric_user;
GRANT SELECT ON public.posts TO electric_user;
```

Then, as a superuser or database owner, follow the [Manual Configuration Steps](#manual-configuration-steps) below to create the publication, add tables, and configure replica identity.

Configure Electric with:

```shell
DATABASE_URL=postgresql://electric_user:secure_password@localhost:5432/mydb
ELECTRIC_MANUAL_TABLE_PUBLISHING=true
```

## AWS RDS and Aurora

AWS RDS and Aurora require special handling for replication permissions. See the [AWS integration guide](/docs/integrations/aws) for details on enabling logical replication and granting the `rds_replication` role.

## Manual Configuration Steps

If you need to manually configure the publication and replica identity (for use with `ELECTRIC_MANUAL_TABLE_PUBLISHING=true`):

### 1. Create the Publication

```sql
-- Create an empty publication
CREATE PUBLICATION electric_publication_default;

-- Or with a custom name (configure with ELECTRIC_REPLICATION_STREAM_ID)
CREATE PUBLICATION my_custom_publication;
```

### 2. Add Tables to the Publication

```sql
-- Add specific tables
ALTER PUBLICATION electric_publication_default ADD TABLE public.users;
ALTER PUBLICATION electric_publication_default ADD TABLE public.posts;
ALTER PUBLICATION electric_publication_default ADD TABLE public.comments;
```

### 3. Configure Replica Identity

For each table you want to sync, you must set the replica identity to `FULL`:

```sql
ALTER TABLE public.users REPLICA IDENTITY FULL;
ALTER TABLE public.posts REPLICA IDENTITY FULL;
ALTER TABLE public.comments REPLICA IDENTITY FULL;
```

This tells Postgres to include all column values in the replication stream, which Electric requires for accurate change tracking.

### 4. Set Publication Ownership

Make the Electric user the owner of the publication (or ensure the publication was created by the same user Electric connects as):

```sql
ALTER PUBLICATION electric_publication_default OWNER TO electric_user;
```

### 5. Verify the Configuration

Check that your publication is correctly configured:

```sql
-- List all publications
SELECT * FROM pg_publication;

-- Check publication settings
SELECT pubname, pubinsert, pubupdate, pubdelete, pubtruncate
FROM pg_publication
WHERE pubname = 'electric_publication_default';

-- List tables in the publication
SELECT schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'electric_publication_default';

-- Check replica identity for tables
SELECT schemaname, tablename, relreplident
FROM pg_class
JOIN pg_namespace ON pg_class.relnamespace = pg_namespace.oid
WHERE relreplident = 'f';  -- 'f' means FULL
```

## Troubleshooting

For common permission errors and their solutions, see the [Database permissions section](/docs/guides/troubleshooting#database-permissions-how-do-i-configure-postgresql-users-for-electric) in the main Troubleshooting guide.

## Next Steps

- Review the [Deployment guide](/docs/guides/deployment) for production setup
- Learn about [Security](/docs/guides/security) best practices
- See [Troubleshooting](/docs/guides/troubleshooting) for common issues
- Check the [Configuration reference](/docs/api/config) for all available options
