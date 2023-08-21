---
title: Limitations
description: >-
  Summary of the maturity stage of the project and known limitations.
---

ElectricSQL is in <strong className="warning-color">public alpha</strong> phase.

:::caution
APIs are not guaranteed to be stable. Backwards incompatible changes may (and will) be introduced in both minor and major version releases.

Key aspects of the system *as currently documented* are not fully implemented yet, as outlined on this page.
:::

## Practical limitations

Key aspects of the system are not yet implemented, including:

1. [DDLX rules](#ddlx-rules) &mdash; SQL syntax, permissions and validation are not supported
2. [Shapes](#shapes) &mdash; currently limited to whole table sync
3. [Data modelling](../usage/data-modelling/index.md) &mdash; limited data types and constraint support
4. [Failure modes](#failure-modes) &mdash; you may need to workaround in development

### DDLX rules

The SQL syntax you see documented on <DocPageLink path="api/ddlx" /> is not yet implemented. Neither are permissions, roles, validation or local SQLite commands.

DDLX support is currently limited to electrifying tables using an SQL proceedure call syntax:

```sql
CALL electric.electrify('items')
```

You can track progress on DDLX support here [electric-sql/pg_proxy/pulls](https://github.com/electric-sql/pg_proxy/pulls).

### Shapes

[Shape-based sync](../usage/data-access/shapes.md) using the [`sync()` function API](../api/clients/typescript.md#sync) currently only supports whole table sync.

There is no support for `where` clauses to filter the initial target rows or `select` clauses to filter the include tree. As a result, current calls to `db.tablename.sync({...})` will "over sync" additional data onto the device.

:::note
There is one temporary feature to filter data onto the local device: set an `electric_user_id` field on your table. If you do, then rows will only be synced if the value of that column matches the value of the authenticated user_id provided in your [auth token](../usage/auth/index.md).

This is a very temporary workaround and will be removed soon!
:::

### Data modelling

We don't currently support any constraints except primary keys. You must remove all unique and check constraints from your Postgres data model.

We have limited data type support. Currently, we only support strings (`text` and non-length-limited `varchar`) and numbers (`smallint`, `integer`, `bigint`, `double precision`). The authoritative list of supported data types is maintained in the [`supported_pg_types/0` function][1].

We also only support forward and additive migrations. Migrations that remove columns or make them more restrictive will fail when applied to electrified tables.

[1]: https://github.com/search?q=repo%3Aelectric-sql%2Felectric+symbol%3Asupported_pg_types&type=code

### Failure modes

Currently, you are likely to experience bugs or behaviour that leads to an inconsistent data state. This is **not** related to the core [consistency model](./consistency.md). It's a consequence of the maturity of the implementation.

If you experience errors like:

- `Migrations cannot be altered once applied`
- `Cannot catch up to the server's current state` 
- `FOREIGN KEY CONSTRAINT failed`

You may need to reset your databases. This involves:

- wiping your client databases by clearing IndexedDB in the browser
- resetting your Potsgres database

To reset your Postgres database, you may need to drop the replication publication. This requires:

```sql
ALTER SUBSCRIPTION postgres_1 DISABLE;
ALTER SUBSCRIPTION postgres_1 SET (slot_name = NONE);
drop subscription postgres_1;
```

You can then recreate your database, e.g.:

```shell
dropdb -f intro
createdb -T template0 -E UTF-8 intro
```

Then:

- run Electric to bootstrap the database
- re-apply your migrations
- re-generate your client

Keep an eye on [electric-sql/electric/pulls](https://github.com/electric-sql/electric) for the latest bugfixes.

## Integrity limitations

ElectricSQL uses a [rich-CRDT data model](./consistency.md#rich-crdts) that allows building local-first applications without falling into common pitfalls of working with eventually consistent databases. However, you still need to follow certain constraints that can’t be verified or enforced automatically by ElectricSQL. The purpose of this section is to document these constraints and why they are required.

By understanding and acknowledging these constraints, you can leverage ElectricSQL more effectively in building robust local-first applications. Some of the limitations are temporary and are being addressed as part of our roadmap (see tags).

### Uniqueness constraints

#### Primary keys need to be globally unique

In centralised databases, the creation of two rows with the same primary key causes one of the transactions to abort. In local-first applications, that conflict would only be detected after-the-fact, leaving the state of clients unreconcilable. In ElectricSQL, we require that each key can only be created by a single client at any point in time, ensuring that primary keys are globally unique.

To ensure that primary keys are globally unique, you can use:

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

Currently, if a user tries to replicate a shape that does not include all reachable tables following the foreign key relations, an error is throws. We are looking into solutions for optimising the amount of data that needs to be replicated into the client, while maintaining foreign keys and enforcing write permissions.
