---
title: Electric v0.10 released with shape filtering
description: >-
  Version 0.10 of ElectricSQL. This is the first release that properly supports where-clause and include-tree filtering with Shape-based sync.
excerpt: >-
  We've published version 0.10 of Electric. This is the
  first release that properly supports where-clause and
  include-tree filtering with Shape-based sync.
authors: [thruflo]
image: /img/blog/introducing-electric-sql/image.jpg
tags: [release]
outline: deep
post: true
---

> [!WARNING]
> This post describes a release of an old version of Electric that's no longer active. See the [Electric Next](/blog/2024/07/17/electric-next) post for context.

We've just published version 0.10 of Electric. This is the first release that properly supports where-clause and include-tree filtering with [Shape-based sync](https://legacy.electric-sql.com/docs/usage/data-access/shapes).

It also adds data type support for byte arrays and blobs.

## Shape filtering

[Shapes](https://legacy.electric-sql.com/docs/usage/data-access/shapes) are the key primitive in the Electric system for controlling what data syncs between the cloud and the local device.

Shape subscriptions are created using the [`sync()` API](/docs/api/clients/typescript#sync), which targets a resource and association graph using where-clauses and an include-tree. However, prior to this release, the implementation of `sync()` was a placeholder that over-synced data and forced you to include all related tables.

Now, with v0.10, we've released shape filtering support that correctly filters rows by where-clause and include-tree. This allows you to use Shapes, as they were intended, to manage dynamic partial replication and optimise the data synced onto a local device.

### What's changed?

The [`sync()` API](/docs/api/clients/typescript#sync) remains the same. For example:

```typescript
const shape = await db.projects.sync({
  where: {
    id: "abcd",
  },
  include: {
    issues: true
  }
})

await shape.synced
```

However, in earlier releases, this would sync all rows in the `projects` and `issues` tables. Now, it will just sync the project with ID `"abcd"` and the issues that belong to it.

In addition, it's now also possible to pass an SQL string as the `where` clause for a shape definition. For example:

```javascript
const { synced } = await electric.db.issues.sync({
  where: "this.project_id in [7, 42]"
})
```

This exposes the implementation of shape sync from the underlying wire protocol, and in future will enable support for additional Postgres operators.

Full details of the SQL syntax permitted in a where clause can be found in the [Shapes documentation](https://legacy.electric-sql.com/docs/usage/data-access/shapes).

### Status — experimental

Shapes as released in v0.10 are still experimental. You **can** now use them to filter the content synced onto the local device. However, key aspects, including controlling sync *off* the device and unsubscribing are still not yet implemented.

You should also be aware that there *is* still some oversync (of many-to-one relations, in order to maintain referential integrity). See the [limitations](https://legacy.electric-sql.com/docs/usage/data-access/shapes#limitations-and-issues) listed in the Shapes docs for more information.

:::caution Breaking changes

If you were previously relying on the temporary behaviour of Shape over-syncing, you may need to update your Shape definitions.
:::

## Blob support

We've added data type support for `BYTEA` columns, aka blobs. See the [type documentation](https://legacy.electric-sql.com/docs/usage/data-modelling/types#supported-data-types) for more info. This unlocks support for apps that store large strings and/or files in the database.

It also unlocks support for databases like [CozoDB](https://www.cozodb.org) that persist data using SQLite blobs. With this release, you can now use Electric to sync Cozo between users and devices, turning it into a multi-user, realtime relational-graph-vector database:

```sql
CREATE TABLE cozo (
  k BLOB primary key,
  v BLOB
);

ALTER TABLE cozo
  ENABLE ELECTRIC;
```

## Bug fixes and more

Every new release of Electric includes bug fixes and small improvements. For a full list of updated components see [Release notes](https://legacy.electric-sql.com/docs/reference/release_notes#2024-04-10---v010).
