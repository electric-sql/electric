---
title: Dynamic sync controls
sidebar_position: 50
---

In [active-active replication](./active-active.md) we've seen how to sync data between Postgres and SQLite. Normally though, when you're building an app, you don't want to sync *all* of the data onto the local-device. You want to limit it to just the data the user needs and is allowed to access.

With ElectricSQL, you control this using [DDLX&nbsp;rules](../usage/data-modelling/permissions.md) and [Shape&#8209;based&nbsp;sync](../usage/data-access/shapes.md).

## DDLX rules

[DDLX&nbsp;rules](../usage/data-modelling/permissions.md) are the core, row-level primitive for *database administrators* to control what data is *allowed* to sync where.

First, tables need to be [electrified](../usage/data-modelling/electrification.md) to sync at all:

```sql
ALTER TABLE projects
  ENABLE ELECTRIC;
```

Then *users* are assigned *roles* based on their authentication state (usually by matching the `user_id` in their [authentication token](../usage/auth/index.md) with foreign keys to your users table):

```sql
ELECTRIC ASSIGN (projects, 'owner')
  TO projects.owner_id;
```

*Roles* are then granted [*permissions*](../usage/data-modelling/permissions.md) to access the data:

```sql
ELECTRIC GRANT ALL
  ON projects
  TO (projects, 'owner');
```

Data only replicates onto a user's device if that user has permission to read it and only replicates off from their device if they have permission to write it.

## Shape-based sync

[Shapes](../usage/data-access/shapes.md) are the core primitive for *app developers* to control what data *actually* syncs where. They are incredibly powerful and flexible: allowing you to reach into a central cloud database, take a subset of related data and sync just that set of data onto the local device.

For example, you can sync:

- a workspace and all its documents and their data
- a region and all its locations and their data
- a time period and all its events

Shapes are live, so if new data arrives that matches the shape, that data also syncs onto the local device. And they're dynamic, so they can change at runtime, using the [`sync`](../api/clients/typescript.md#sync) function, e.g.:

<!--

Below, we have a simplified example of a project management app. There are projects that can be synced and the projects contain issues. The home screen shows the 10 latest issues across projects and the projects that are available to sync.

<CodeBlock live={true} noInline={true} language="jsx">{
  ' ' // as described
}</CodeBlock>

Because the data is synced onto the local app, the local app is fully functional offline. You can still navigate and engage with it without connectivity.

The shape of the data that is synced changes at runtime and is defined by a simple [`sync`](../api/clients/typescript.md#sync) call:

-->

```tsx
const shape = await db.projects.sync({
  where: {
    id: {
      in: selectedProjectIds
    }
  },
  include: {
    issues: {
      include: {
        comments: true
      }
    }
  }
})
```

Within a shape, data is filtered based on permissions. So if you sync all projects:

```tsx
const shape = await db.projects.sync({
  where: true
})
```

The user will only actually get the projects that they're authorised to access.

<hr className="doc-divider" />

That's a taster of how you control what data syncs where. Let's wrap up by looking at the [real-world apps](./real-world.md) you can build with this model &raquo;
