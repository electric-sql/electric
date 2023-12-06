---
title: Writes
description: >-
  Write data instantly to the local embedded database.
sidebar_position: 50
---

# Writing data

Insert, update and delete data using the [`create`](../../api/clients/typescript.md#create), [`createMany`](../../api/clients/typescript.md#createMany), [`update`](../../api/clients/typescript.md#update), [`updateMany`](../../api/clients/typescript.md#updateMany), [`delete`](../../api/clients/typescript.md#delete) and [`deleteMany`](../../api/clients/typescript.md#deleteMany) functions.

For example, to insert a new project:

```ts
const project = await db.projects.create({
  data: {
    name: 'ElectricSQL',
    description: 'Instant local-first for your Postgres'
  }
})
```

To update the same project:

```ts
await db.projects.update({
  where: {
    id: project.id
  },
  data: {
    description: 'Local-first Postgres'
  }
})
```

To delete the project:

```ts
await db.projects.delete({
  where: {
    id: project.id
  }
})
```

## Reacting to writes

Writes automatically cause any relevant [live queries](./queries.md#live-queries) to update. For example, if you take the following component:

```ts
const MyComponent = () => {
  const { db } = useElectric()!
  const { results } = useLiveQuery(db.projects.liveMany())

  const add = async () => (
    await db.projects.create({
      data: {
        /* ... */
      }
    })
  )

  return <List items={results} add={add} />
}
```

Calling `add` will insert a new project into the local database. ElectricSQL will automatically detect and replicate the write. The replication process emits a notification, causing the live query to re-run. This updates the value of the `results` state variable, which triggers the component to re-render.

This automatic reactivity works no matter where the write is made &mdash; locally, [on another device, by another user](../../intro/multi-user.md), or [directly into Postgres](../../intro/active-active.md).
