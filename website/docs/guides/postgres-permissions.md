---
title: PostgreSQL Permissions - Guide
description: >-
  How to create and configure PostgreSQL users with the necessary permissions for Electric.
outline: [2, 3]
---

# PostgreSQL Permissions

This guide explains how to create PostgreSQL users with the necessary permissions for Electric to work correctly. Electric requires specific database privileges to enable [logical replication](https://www.postgresql.org/docs/current/logical-replication.html) and manage publications.

## Which Permission Setup Should You Use?

Choose based on your requirements:

### 🟢 Superuser (Recommended for Development)
- **Use when:** Local development, testing, or simple production deployments
- **Pros:** Simplest setup, Electric manages everything automatically
- **Cons:** Highest privilege level
- **Setup:** Use `DATABASE_URL=postgresql://postgres:...`
- → [Details](#for-development)

### 🔵 Electric-managed publications (Automatic Mode, Recommended for Production)
- **Use when:** Production where Electric can own the database tables
- **Pros:** Electric manages publications and REPLICA IDENTITY automatically
- **Cons:** Electric must own tables (app loses ownership)
- **Setup:** Create dedicated user, transfer table ownership
- → [Details](#electric-managed-publications-setup)

### 🔴 Manual Mode (Least Privilege)
- **Use when:** High security environments, app must own tables, strict privilege separation
- **Pros:** App keeps table ownership, minimal Electric privileges
- **Cons:** DBA must pre-configure publications and add new tables manually
- **Setup:** Create user with REPLICATION + SELECT only, DBA configures publications
- → [Details](#manual-mode-setup)

## Automatic vs Manual Publication Management

Electric can operate in two modes:

### 1. Electric-managed publications (Automatic Mode, Recommended)

Electric automatically creates the publication and adds tables to it as shapes are requested. Requires `CREATE` privilege on the database and table ownership. PostgreSQL requires table ownership to both add tables to publications and set `REPLICA IDENTITY FULL`.

### 2. Manual Mode

You manually manage the publication and Electric only validates the configuration. Enable this with [`ELECTRIC_MANUAL_TABLE_PUBLISHING=true`](/docs/api/config#electric-manual-table-publishing). Requires only `REPLICATION` and `SELECT` privileges, but you must pre-configure the publication and `REPLICA IDENTITY FULL`.

## Core Permission Requirements

Electric needs different PostgreSQL permissions depending on the mode:

| Permission | Purpose | Electric-managed | Manual Mode |
|------------|---------|------------------|-------------|
| [`REPLICATION`](https://www.postgresql.org/docs/current/sql-createrole.html) | Enable logical replication streaming | ✅ Required | ✅ Required |
| [`SELECT`](https://www.postgresql.org/docs/current/sql-grant.html) on tables | Read table data for initial shape snapshots | ✅ Required | ✅ Required |
| [`CREATE`](https://www.postgresql.org/docs/current/ddl-priv.html) on database | Create publications | ✅ Required | ❌ Not needed |
| [Table ownership](https://www.postgresql.org/docs/current/ddl-priv.html) | Set [`REPLICA IDENTITY FULL`](https://www.postgresql.org/docs/current/sql-altertable.html) and add tables to publications | ✅ Required | ❌ DBA configures |
| [Publication ownership](https://www.postgresql.org/docs/current/sql-createpublication.html) | Modify publications (add/remove tables) | ✅ Required | ❌ DBA configures |

## Setup Examples

### For Development

Use the default `postgres` superuser or another superuser role:

```shell
DATABASE_URL=postgresql://postgres:your_password@localhost:5432/your_database
```

Electric will automatically create publications, configure `REPLICA IDENTITY FULL`, and manage everything for you. This can also work for simple production deployments where the simplicity and ease of setup outweigh security concerns.

### Electric-managed publications Setup

Create a dedicated Electric user with automatic table configuration. Electric will create publications and add tables as shapes are requested.

```sql
-- Create the Electric user with REPLICATION
CREATE ROLE electric_user WITH LOGIN PASSWORD 'secure_password' REPLICATION;

-- Grant database-level privileges
GRANT CONNECT ON DATABASE mydb TO electric_user;
GRANT USAGE ON SCHEMA public TO electric_user;
GRANT CREATE ON DATABASE mydb TO electric_user;  -- Needed to create publications

-- Grant SELECT on tables (Electric is read-only, only needs to read data)
-- For all tables:
GRANT SELECT ON ALL TABLES IN SCHEMA public TO electric_user;

-- Grant SELECT on future tables automatically (https://www.postgresql.org/docs/current/sql-alterdefaultprivileges.html)
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO electric_user;

-- For specific tables only:
-- GRANT SELECT ON public.users, public.posts TO electric_user;
```

**Transfer table ownership to Electric:**

For Electric-managed publications, you must transfer table ownership to `electric_user`. PostgreSQL requires table ownership to add tables to publications and set `REPLICA IDENTITY FULL`.

For specific tables (recommended):

```sql
-- Transfer ownership for specific tables you want Electric to manage
ALTER TABLE public.users OWNER TO electric_user;
ALTER TABLE public.posts OWNER TO electric_user;
ALTER TABLE public.comments OWNER TO electric_user;
```

Or for all tables in the schema:

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
> Transferring table ownership removes ownership from the previous owner. If you need your application to retain table ownership, use [Manual Mode](#manual-mode-setup) instead, where a DBA pre-configures the publication and `REPLICA IDENTITY FULL`.

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

### 1. [Create the Publication](https://www.postgresql.org/docs/current/sql-createpublication.html)

```sql
-- Create an empty publication
CREATE PUBLICATION electric_publication_default;

-- Or with a custom name (configure with ELECTRIC_REPLICATION_STREAM_ID)
CREATE PUBLICATION my_custom_publication;
```

### 2. [Add Tables to the Publication](https://www.postgresql.org/docs/current/sql-alterpublication.html)

```sql
-- Add specific tables
ALTER PUBLICATION electric_publication_default ADD TABLE public.users;
ALTER PUBLICATION electric_publication_default ADD TABLE public.posts;
ALTER PUBLICATION electric_publication_default ADD TABLE public.comments;
```

### 3. [Configure Replica Identity](https://www.postgresql.org/docs/current/sql-altertable.html)

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
-- Verify the Electric role has REPLICATION privilege
SELECT rolname, rolreplication
FROM pg_roles
WHERE rolname = 'electric_user';

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
