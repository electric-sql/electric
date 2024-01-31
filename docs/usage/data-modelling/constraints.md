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

ElectricSQL supports [not-null constraints](https://www.postgresql.org/docs/current/ddl-constraints.html#id-1.5.4.6.6) as long as the constraint is defined when creating the table or before the table is electrified.

```sql
CREATE TABLE items (
  -- Implicit non null constraint
  id UUID PRIMARY KEY

  -- Explicit non null constraint
  foo TEXT NOT NULL

  -- Can be null
  bar TEXT
)
```

Adding a column with a not-null constraint is supported, but **not advisable** until default values are implemented:

```sql
ALTER TABLE items
  -- Additive migration, supported
  ADD COLUMN baz TEXT NOT NULL;

   -- Possible substitute for default values
  SET baz = "fie";
```

Adding a column with not-null constraints after the table is electrified is *technically* possible because it's an [additive migration](./migrations.md#limitations). However, since ElectricSQL does not yet support default values, the migration itself would need to supply non-null values for each existing row for the constraint to be fulfilled.

In theory, this is possible to do if you can guarantee that no new rows are in-flight, pending locally on a client or will be added by a client not yet updated. This is not a guarantee that can normally be made.

Without it, writes that were accepted locally with implicit null values in the new column would need to be rejected, which would violate the [finality of local writes](../../reference/architecture.md#local-writes).

Constraining an existing column by adding a not-null constraint to it is **not supported**:

```sql
ALTER TABLE items
  -- Not additive, not supported
  ALTER COLUMN bar TEXT NOT NULL;
```

This type of migration is not supported since it isn't *additive*. The same reasoning about *finality of local writes* applies here.

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
