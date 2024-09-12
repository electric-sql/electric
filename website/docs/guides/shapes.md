---
title: Shapes - Guide
description: >-
  Shapes are the core primitive for controlling sync in the ElectricSQL system.
outline: deep
---

<script setup>
import SyncShapeJPG from '/static/img/docs/guides/shapes/sync-shape.jpg?url'
import SyncShapePNG from '/static/img/docs/guides/shapes/sync-shape.png?url'
</script>

# Shapes

Shapes are the core primitive for controlling sync in the ElectricSQL system.

## What is a Shape?

Electric syncs little subsets of your Postgres data into local apps, services and environments. Those subsets are defined using Shapes.

### Little subsets

Imagine a Postgres database in the cloud with lots of data stored in it. It's often impractical or unwanted to sync all of this data over the network onto a local device.

A shape is a way of defining a subset of that data that you'd like to sync into a local app. Defining shapes allows you to sync just the data you want and just the data that's practical to sync onto the local device.

<figure>
  <a :href="SyncShapeJPG">
    <img :src="SyncShapePNG"
        alt="Illustration of syncing a shape"
    />
  </a>
</figure>

A client can choose to sync one shape, or lots of shapes. Many clients can sync the same shape. Multiple shapes can overlap.

## Defining shapes

Shapes are defined by:

- a `root_table`, such as `projects`
- a `where` clause, used to filter the rows in that table, such as `status='active'`

> [!IMPORTANT] Limitations
> Shapes are currently single table, whole row only. You can sync all the rows in a table, or a subset of the rows in that table. You can't yet [select columns](#whole-rows) or sync an [include tree](#single-table) without filtering or joining in the client.

### `root_table`

This is the root table of the shape. It must match a table in your Postgres database.

The value can be just a tablename like `projects`, or can be a qualified tablename prefixed by the database schema using a `.` delimiter, such as `foo.projects`. If you don't provide a schema prefix, then the table is assumed to be in the `public.` schema.

### `where` clause

Optional where clause to filter rows in the `root_table`.

This must be a valid [PostgreSQL WHERE clause](https://www.postgresql.org/docs/current/queries-table-expressions.html#QUERIES-WHERE) using SQL syntax, e.g.:

- `title='Electric'`
- `status IN ('backlog', 'todo')`

You can use logical operators like `AND` and `OR` to group multiple conditions, e.g.:

- `title='Electric' OR title='SQL'`
- `title='Electric' AND status='todo'`

Where clauses can only refer to columns in the target row; you can't perform joins or refer to other tables. Where clauses also can't use SQL functions like `count()`.

## Subscribing to shapes

Local clients establish shape subscriptions, typically using [client libraries](/docs/api/clients/typescript). These sync data from the [Electric sync service](/product/electric) into the client using the [HTTP API](/docs/api/http).

The sync service maintains shape subscriptions and streams any new data and data changes to the local
client. In the client, shapes can be held as objects in memory, for example using a [`useShape`](/docs/api/integrations/react) hook, or in a normalised store or database like [PGlite](/product/pglite).

### HTTP

You can sync shapes manually using the
<a href="/openapi.html#/paths/~1v1~1shape~1%7Broot_table%7D/get"
    target="_blank">
  <code>GET /v1/shape</code></a> endpoint. First make an initial sync request to get the current data for the Shape, such as:

```sh
curl -i 'http://localhost:3000/v1/shape/foo?offset=-1'
```

Then switch into a live mode to use long-polling to receive real-time updates:

```sh
curl -i 'http://localhost:3000/v1/shape/foo?live=true&offset=...&shape_id=...'
```

These requests both return an array of [Shape Log](/docs/api/http#shape-log) entries. You can process these manually, or use a higher-level client.

### Typescript

You can use the [Typescript Client](/docs/api/clients/typescript) to process the Shape Log and materialised it into a `Shape` object for you.

First install using:

```sh
npm i @electric-sql/client
```

Instantiate a `ShapeStream` and materialise into a `Shape`:

```ts
import { ShapeStream, Shape } from '@electric-sql/client'

const stream = new ShapeStream({
  url: `http://localhost:3000/v1/shape/foo`,
})
const shape = new Shape(stream)

// Returns promise that resolves with the latest shape data once it's fully loaded
await shape.value
```

You can register a callback to be notified whenever the shape data changes:

```ts
shape.subscribe(shapeData => {
  // shapeData is a Map of the latest value of each row in a shape.
})
```

Or you can use framework integrations like the [`useShape`](/docs/api/integrations/react) hook to automatically bind materialised shapes to your components.

See the [Quickstart](/docs/quickstart) and [HTTP API](/docs/api/http) docs for more information.

## Limitations

### Single table

Shapes are currently single table only.

In the [old version of Electric](https://legacy.electric-sql.com/docs/usage/data-access/shapes), Shapes had an include tree that allowed you to sync nested relations. The new Electric has not yet implemented support for include trees.

You can upvote and discuss adding support for include trees here:

- [Shape support for include trees #1608](https://github.com/electric-sql/electric/discussions/1608)

> [!TIP] Include tree workarounds
> There are some practical workarounds you can already use to sync related data, based on subscribing to multiple shapes and joining in the client.
>
> For a one-level deep include tree, such as "sync this project with its issues", you can sync one shape for projects `where="id=..."` and another for issues `where="project_id=..."`.
>
> For multi-level include trees, such as "sync this project with its issues and their comments", you can denormalise the `project_id` onto the lower tables so that you can also sync comments `where="project_id=1234"`.
>
> Where necessary, you can use triggers to update these denormalised columns.

### Whole rows

Shapes currently sync all the columns in a row.

It's not yet possible to select or ignore/mask columns. You can upvote and discuss adding support for selecting columns here:

- [Shape support for selecting columns #1676](https://github.com/electric-sql/electric/discussions/1676)

### Immutable

Shapes are currently immutable.

Once a shape subscription has been started, it's definition cannot be changed. If you want to change the data in a shape, you need to start a new subscription.

You can upvote and discuss adding support for mutable shapes here:

- [Editable shapes #1677](https://github.com/electric-sql/electric/discussions/1677)

<!--
## Performance

... add links to benchmarks here ...

-->
