---
title: Roadmap
description: >-
  Summary of the maturity stage of the project and known limitations.
---

ElectricSQL is in <strong className="warning-color">public alpha</strong> phase.

APIs are not guaranteed to be stable. Backwards incompatible changes may (and will) be introduced in patch, minor and major version releases.

## Practical limitations

Key aspects of the system are not fully implemented yet:

1. [Data modelling](#data-modelling) &mdash; remove constraints and ensure migrations are additive
2. [DDLX rules](#ddlx-rules) &mdash; `ELECTRIC ENABLE` fully supported.
   Read-only permissions available using the feature flag
   `ELECTRIC_FEATURES=permissions=true`.
3. [Shapes](#shapes) &mdash; support following relations and partial sync, but with some limitations

Plus you may encounter [failure modes](#failure-modes) that you need to work around in development

### Data modelling

There are a number of [fundamental limitations](#fundamental-limitations) of the local-first model you should be aware of. These have a practical impact on data model support, for example:

- **primary keys**: sequential IDs are not supported; you [must use binary UUIDs](../usage/data-modelling/types.md#primary-keys)

In addition, there are a number of limitations of the current implementation that impact data model support:

- **data types**: see the list of [supported data types](../usage/data-modelling/types.md#supported-data-types)
- **constraints**: you must remove [unique and check constraints](../usage/data-modelling/constraints.md#unsupported)
- **migrations**: you must use [additive, forward migrations](../usage/data-modelling/migrations.md#limitations)

See <DocPageLink path="usage/data-modelling" /> for more information.

### DDLX rules

The DDLX rules for permissions, roles, validation or local SQLite commands documented on <DocPageLink path="api/ddlx" /> are not fully implemented yet.

- **ELECTRIC GRANT**:

  - Limited to read-only permissions. Attempting to grant `INSERT`, `UPDATE`,
    or `DELETE` privileges will be rejected by the proxy.
  - Column based partial replication of tables is currently not supported
  - Limiting `INSERT`s to a column subset is currently not supported

- **Permissions scopes**

  - Scope resolution is via foreign key relations only, based on some simple
    heuristics that attempt to confine the path to other tables within the same
    scope.

    For instance if you have a schema that looks like this:

    ```sql
    CREATE TABLE projects (
        id uuid PRIMARY KEY,
        name text
    );
    CREATE TABLE issues (
        id uuid PRIMARY KEY,
        project_id uuid NOT NULL REFERENCES projects (id),
        title text
    );
    CREATE TABLE comments (
        id uuid PRIMARY KEY,
        issue_id uuid NOT NULL REFERENCES issues (id),
        references_project_id uuid REFERENCES projects (id),
        comment text
    );
    ```

    and create scoped permissions:

    ```sql
    -- grants for projects and issues...
    ELECTRIC GRANT ALL ON comments TO (projects, 'member');
    ```

    then the scope resolution would (correctly) identify that the project scope
    for `comments` would be resolved through the `issue_id` column via the
    `issues` table.

    However, if you added some duplicate foreign key from `issues` to
    `projects`, say `previous_project_id` then the scope root for an issue would
    equally likely be resolved as the target of `project_id` or
    `previous_project_id`.

    Equally if the `issues` table doesn't have a foreign key pointing to the
    `projects` table, then attempting to grant permissions scoped on `projects`
    will fail.

    In future the `GRANT` statement will provide some syntax to specify the
    exact "path" to the scope root for any given table.

- **ELECTRIC SQLITE** is not implemented.

### Shapes

[Shape-based sync](../usage/data-access/shapes.md) using the [`sync()` function](../api/clients/typescript.md#sync-method) is currently supported with some [limitations](../usage/data-access/shapes.md#limitations-and-issues). You can ask for specific tables and rows, filter them, and follow relations.

### Failure modes

Currently, you may experience bugs or behaviour that leads to an inconsistent data state. This is **not** related to the core [consistency model](./consistency.md). It's a consequence of the lack of validation and some recovery modes still pending implementation.

In development, you can usually recover from these bugs by resetting your database(s). In the browser, if you clear localStorage and IndexedDB (for example, in Chrome, "Inspect" to open the developer tools -> Application -> Storage -> Clear site data) that will reset the client and your local app will re-sync from the server.

If you need to reset your Postgres database, if you're using Docker Compose (such as with the starter template or examples) you can usually use something like `yarn backend:down` or `docker compose -f backend/compose.yaml down --volumes`. Alternatively, if you can't just nuke your whole database folder, you'll need to manually drop the objects created by Electric:

- (optional) subscription `electric_1`
- publication `electric_publication`
- schema `electric`
- replication slot `electric_replication_out_<dbname>`

Double-check the replication slot name in your database by executing

```sql
SELECT slot_name, slot_type, database FROM pg_replication_slots;
```

Example output:

```
             slot_name             │ slot_type │ database
───────────────────────────────────┼───────────┼──────────
 electric_replication_out_electric │ logical   │ electric
(1 row)
```

Then edit in your slot name in the following code block and execute it in your database to remove everything cleanly:

```sql
DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_subscription
               WHERE subname = 'postgres_1') THEN
      ALTER SUBSCRIPTION postgres_1 DISABLE;
      ALTER SUBSCRIPTION postgres_1 SET (slot_name = NONE);
      DROP SUBSCRIPTION postgres_1;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_publication
               WHERE pubname = 'electric_publication') THEN
      DROP PUBLICATION electric_publication;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_namespace
               WHERE nspname = 'electric') THEN
      DROP SCHEMA electric CASCADE;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_replication_slots
               WHERE slot_name = 'electric_replication_out_electric') THEN
      SELECT pg_drop_replication_slot('electric_replication_out_electric');
    END IF;
  END
$$;
```

You can then recreate your database, e.g.:

```shell
dropdb -f intro
createdb -T template0 -E UTF-8 electric
```

Then:

- run Electric to bootstrap the database
- re-apply your migrations
- re-generate your client

## Fundamental limitations

ElectricSQL uses a [rich-CRDT data model](./consistency.md#rich-crdts) that allows building local-first applications without falling into common pitfalls of working with eventually consistent databases. However, you still need to follow certain constraints that can’t be verified or enforced automatically by ElectricSQL. The purpose of this section is to document these constraints and why they are required.

By understanding and acknowledging these constraints, you can leverage ElectricSQL more effectively in building robust local-first applications. Some of the limitations are temporary and are being addressed as part of our roadmap (see tags).

### Uniqueness constraints

#### Primary keys need to be unique

In centralised databases, the creation of two rows with the same primary key causes one of the transactions to abort. In local-first applications, that conflict would only be detected after-the-fact, leaving the state of clients unreconcilable. In ElectricSQL, we require that each key can only be created by a single client at any point in time, ensuring that primary keys are unique (to their table -- rows in different tables can have the same primary key value).

To ensure that primary keys are unique, you can use:

- UUIDs are typically a safe approach (be aware of limitation with some browsers and devices [REF])
- Unique data about the client for generating the value safely. E.g., use the clientId in a composed primary-key.

#### No support SERIAL or SEQUENCE in Primary keys

If two user’s see the same sequence value, both will generate the same next value. Sequences don’t adhere to the global uniqueness requirement.

**Roadmap**

- we intend to support sequential identifier generation through specialised support
- Map SERIAL and SEQUENCE to SQLite AUTO INCREMENT

### No support for UNIQUE constraints

Unique constraints are subject to the same limitations of primary keys.

**Roadmap**

- We disabled them as an initial simplification.

#### Primary keys are immutable

Changing primary keys after their creation could lead to undefined behaviour. e.g., if a client updates some columns of a row, and concurrently another client updates the primary key of that row, shall those changes me merged together or not?

**Roadmap**

- Abort a transaction that modified a primary key of an electrified table, in SQLite and Postgres.

### Foreign keys can only be defined on primary keys

Roadmap:

- Can be relaxed to support UNIQUE constraints

### Data Integrity

#### Single-value CHECK constraints

Imagine that a table has a constraint that at most two out of three flags can be checked at any time (represented as boolean columns). Two transactions individually might enable two flags, but the result of merging these transactions can result in having the three flags checked.

**Roadmap**

- We wil extend the type of CHECK constraints that we support, using rich-CRDTs

### Triggers

#### No support for triggers on SQLite

Any existing trigger in an Electrified table will not be propagated to the clients.. his is an initial simplification, while we design proper trigger support for ElectricSQL.

**Roadmap**

- Once we unlock raw SQL support, we will add support for adding triggers SQLite to SQLite tables too
- We are still working in proper trigger-firing rules

#### No conversion of triggers between Postgres and SQLite

The same trigger written for Postgres or SQLite end up having very different definitions and is difficult to convert between them.

### Shapes

#### Transitively replicate tables referred in foreign keys

Why: maintaining foreign key integrity requires write permissions on referred rows. We’re working under the simplification that a client is only able to modify a row with a foreign key if it has a copy of the referred row. We do this to maintain referential integrity (integrity example link), otherwise we would need to disable foreign key checks.

**Roadmap**:

Currently, if a user tries to replicate a shape that does not include all reachable tables following the foreign key relations, an error is thrown. We are looking into solutions for optimising the amount of data that needs to be replicated into the client, while maintaining foreign keys and enforcing write permissions.
