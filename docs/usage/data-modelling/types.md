---
title: Types
description: >-
  Data types supported by the ElectricSQL system.
sidebar_position: 40
---

ElectricSQL syncs data between Postgres and SQLite.

To do this, we map between [Postgres data types](https://www.postgresql.org/docs/current/datatype.html) and [SQLite data types](https://www.sqlite.org/datatype3.html). In addition, we validate [local writes](../../reference/architecture.md#local-writes) to ensure that the values written into the local database will successfully replicate into Postgres.

As a result, we support a limited set of validated Postgres data types. If you try to [electrify a table](./electrification.md) which contains unsupported types or [constraints](./constraints.md), this will fail. The same applies for altering an electrified table.

## Primary keys

Primary keys must be unique and immutable.

ElectricSQL does not support sequential autoincrementing integer IDs. You must use globally unique primary key identifiers. Typically this means binary UUIDs.

You are responsible for ensuring the uniqueness of your primary keys. If you somehow concurrently create two rows with the same primary key this will cause an integrity violation when the rows are synced.

## Supported data types

**Strings**:

- `text`
- non-length-limited `varchar`

**Numbers**:

- `smallint`
- `integer`
- `bigint`
- `double precision`

The authoritative list of supported data types is maintained in the [`supported_pg_types/0` function](https://github.com/search?q=repo%3Aelectric-sql%2Felectric+symbol%3Asupported_pg_types&type=code).

<hr className="doc-divider" />

:::caution Work in progress
We are actively working on building out data type support. If you need a type we don't yet support, please [let us know on Discord](https://discord.electric-sql.com).
:::
