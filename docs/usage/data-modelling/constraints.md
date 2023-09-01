---
title: Constraints
description: >-
  Constraints and invariants supported by the ElectricSQL system.
sidebar_position: 50
---

Invariant support is currently limited to referential integrity and non-null constraints. Unique and check constraints are not yet supported.

## Supported

### Referential integrity

ElectricSQL maintains referential integrity of foreign key references. So you can use foreign key relationships in your data model and rely on referential integrity:

```sql
CREATE TABLE posts (
  id UUID PRIMARY KEY
);

CREATE TABLE comments (
  id UUID PRIMARY KEY

  post_id UUID REFERENCES(posts.id) ON DELETE CASCADE
);
```

This works even when making writes locally in an offline database. See [Introduction -> Conflict-free offline -> Preserving data integrity](../../intro/offline.md#preserving-data-integrity) and the Rich-CRDT post on [Compensations](/blog/2022/05/03/introducing-rich-crdts#compensations) for more information.

### Non-null constraints

ElectricSQL supports [non-null constraints](https://www.postgresql.org/docs/current/ddl-constraints.html#id-1.5.4.6.6) as long as the constraint is defined when creating the column.

I.e.: the non-null constraint must be defined in an [additive migration](./migrations.md#limitations). So the following is supported because creating the table with new columns is *additive*:

```sql
CREATE TABLE items (
  -- implicit non null constraint
  id UUID PRIMARY KEY

  -- explicit non null constraint
  foo TEXT NOT NULL

  -- can be null
  bar TEXT
)
```

This is supported because adding a column is *additive*:

```sql
ALTER TABLE items
  ADD COLUMN baz TEXT NOT NULL;
```

This is **not supported** because constraining the existing column is *destructive*:

```sql
ALTER TABLE items
  ALTER COLUMN bar TEXT NOT NULL;
```

## Unsupported

Where a constraint on a table is unsupported, you must remove it before [electrifying](./electrification.md) that table.

### Check constraints

ElectricSQL does not currently support [check constraints](https://www.postgresql.org/docs/current/ddl-constraints.html#DDL-CONSTRAINTS-CHECK-CONSTRAINTS).

### Unique constraints

ElectricSQL does not currently support [unique constraints](https://www.postgresql.org/docs/current/ddl-constraints.html#DDL-CONSTRAINTS-UNIQUE-CONSTRAINTS).

<hr className="doc-divider" />

:::caution Work in progress
We're working to support:

- unique constraints [using Reservations](/blog/2022/05/03/introducing-rich-crdts#reservations)
- *single column* and then *multi-column* check constraints using validation

See [Rich-CRDTs](/blog/2022/05/03/introducing-rich-crdts) for more information.
:::