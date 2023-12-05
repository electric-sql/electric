---
title: Types
description: >-
  Data types supported by the ElectricSQL system.
sidebar_position: 40
---

ElectricSQL syncs data between Postgres and SQLite.

To do this, we map between [Postgres data types](https://www.postgresql.org/docs/current/datatype.html) and [SQLite data types](https://www.sqlite.org/datatype3.html). In addition, we validate [local writes](../../reference/architecture.md#local-writes) to ensure that the values written into the local database will successfully replicate into Postgres.

As a result, we support a limited set of validated Postgres data types. If you try to [electrify a table](./electrification.md) which contains unsupported types or [constraints](./constraints.md), this will fail. The same applies to altering an electrified table.

## Primary keys

Primary keys must be unique and immutable.

ElectricSQL does not support sequential autoincrementing integer IDs. You must use globally unique primary key identifiers. Typically this means binary UUIDs.

You are responsible for ensuring the uniqueness of your primary keys. If you somehow concurrently create two rows with the same primary key this will cause an integrity violation when the rows are synced.

## Supported data types

**Numeric**:

- `smallint` / `int2`
- `integer` / `int` / `int4`
- `bigint` / `int8`
- `real` / `float4`
- `double precision` / `float8`

**Strings**:

- `character varying` / `varchar` (without length specifier)
- `text`

**Date and time**:

- `date`
- `time` (without precision specifier)
- `timestamp`, `timestamptz` (without precision specifier)

**Other**:

- `boolean`
- `jsonb`
- `uuid`

The authoritative list of supported data types is maintained in the `supported_types()` function in [`components/electric/lib/electric/postgres.ex`](https://github.com/electric-sql/electric/blob/37f3ee4cbf06ef80e80ed8663b420b2bdeb7cb1b/components/electric/lib/electric/postgres.ex#L83-L95).

:::info JSON support
Electric uses a Last-Writer-Wins strategy. For JSON this is across the whole document - updating one attribute in the document counts as the document as a whole being updated. This means that conflicting updates from multiple clients are not merged together, the full state of the last writer will be stored. In future we plan to support other CRDTs and merging strategies with JSON.
:::

:::caution Work in progress
We are actively working on building out data type support. If you need a type we don't yet support, please [let us know on Discord](https://discord.electric-sql.com).
:::
