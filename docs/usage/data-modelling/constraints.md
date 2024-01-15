---
title: Constraints
description: >-
  Constraints and invariants supported by the ElectricSQL system.
sidebar_position: 50
---

Invariant support is currently limited to referential integrity and not-null constraints. Unique and check constraints are not yet supported.

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

:::info
To preserve referential integrity Electric prevents [updates to a table's primary keys](./validation.md#immutable-primary-keys).
:::

:::caution
Electric currently does not allow adding a new foreign key column with `ALTER TABLE ... ADD COLUMN` to an electrified table. This limitation will be removed in a future release.
:::

### Not-null constraints

ElectricSQL supports [not-null constraints](https://www.postgresql.org/docs/current/ddl-constraints.html#id-1.5.4.6.6) as long as the constraint is defined when creating the column.

I.e.: the not-null constraint must be defined in an [additive migration](./migrations.md#limitations). So the following is supported because creating the table with new columns is *additive*:

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

Adding a column with a not-null constraint is supported because it's *additive*:

```sql
ALTER TABLE items
  ADD COLUMN baz TEXT NOT NULL;
```

Constraining an existing column by adding a not-null constraint to it is **not supported**:

```sql
-- Not supported
ALTER TABLE items
  ALTER COLUMN bar TEXT NOT NULL;
```

This is not supported because it may invalidate concurrent, in-flight operations. Specifically, writes that were accepted locally with null values would need to be rejected, which would violate the [finality of local writes](../../reference/architecture.md#local-writes).

## Unsupported

Unsupported constraints must be removed from a table before [electrifying](./electrification.md) it.

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
