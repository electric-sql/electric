---
title: Electrification
description: >-
  How to expose tables to the replication machinery.
sidebar_position: 30
---

By default, ElectricSQL does not expose or replicate any data.

In order to sync data between Postgres and local-devices, you have to first "electrify" tables to add them to the replication machinery. You can then [assign permissions](./permissions.md) to expose read and write access to the data.

You can only electrify tables with supported data types and constrainsts. See [Types](./types.md) and [Constraints](./constraints.md) for more information.

:::caution Work in progress
Currently, electrification is supported by an [SQL procedure call syntax](../../reference/roadmap.md#ddlx-rules).
:::

## Enable

Electrify tables in your [DDL migrations](./migrations.md) using the [`ALTER TABLE ... ENABLE ELECTRIC`](../../api/ddlx#enable) DDLX statement. For example, to electrify the `projects` and `issues` tables:

```sql
ALTER TABLE projects
  ENABLE ELECTRIC;

ALTER TABLE issues
  ENABLE ELECTRIC;
```

Each table needs to be electrified individually. You can only expose permissions on electrified tables.

## Disable

Use [`ALTER TABLE ... DISABLE ELECTRIC`](../../api/ddlx#disable) to stop replicating a table, e.g.:

```sql
ALTER TABLE issues
  DISABLE ELECTRIC;
```

Note that this will fail if you have any roles, permissions or other rules defined on the table. It's your responsibility to remove those first before you unelectrify the table.

<div className="pb-3">
  <hr className="doc-divider" />
</div>

:::info
Electrification on its own does not expose any data. It's like an extra security measure to make sure you only ever replicate data from tables you've explicitly enabled.

In addition, tables that are not electrified are not included in the database schema that the client has access to. So sensitive information in the DDL schema itself (such as private dynamic table names) is not exposed unless explicitly enabled.
:::
