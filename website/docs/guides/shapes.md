---
title: Shapes - Guide
description: >-
  Shapes are the core primitive for controlling sync in the ElectricSQL system.
image: /img/guides/sync-shape.jpg
outline: deep
---

<script setup>
import SyncShapeSVG from '/static/img/docs/guides/shapes/sync-shape.svg?url'
</script>

<img src="/img/icons/shapes.svg"
    class="product-icon"
/>

# Shapes

Shapes are the core primitive for controlling sync in the ElectricSQL system.

:::tip Production Best Practice
While shapes can be requested directly from Electric, **production applications should request shapes through your backend API**. This allows your server to control table access, construct where clauses for authorization, and maintain security. See the [authentication guide](/docs/guides/auth) for implementation patterns.
:::

## What is a Shape?

Electric syncs little subsets of your Postgres data into local apps and services. Those subsets are defined using Shapes.

### Little subsets

Imagine a Postgres database in the cloud with lots of data stored in it. It's often impractical or unwanted to sync all of this data over the network onto a local device.

A shape is a way of defining a subset of that data that you'd like to sync into a local app. Defining shapes allows you to sync just the data you want and just the data that's practical to sync onto the local device.

<figure>
  <img :src="SyncShapeSVG"
      alt="Illustration of syncing a shape"
      style="width: 100%; max-width: 576px;"
  />
</figure>

A client can choose to sync one shape, or lots of shapes. Many clients can sync the same shape. Multiple shapes can overlap.

## Defining shapes

Shapes are defined by:

- a [table](#table), such as `items`
- an optional [where clause](#where-clause) to filter which rows are included in the shape
- an optional [columns](#columns) clause to select which columns are included

A shape contains all of the rows in the table that match the where clause, if provided. If a columns clause is provided, the synced rows will only contain those selected columns.

> [!Warning] Limitations
> Shapes are currently [single table](#single-table). Shape definitions are [immutable](#immutable).

### Table

This is the root table of the shape. All shapes must specify a table and it must match a table in your Postgres database.

The value can be just a tablename like `projects`, or can be a qualified tablename prefixed by the database schema using a `.` delimiter, such as `foo.projects`. If you don't provide a schema prefix, then the table is assumed to be in the `public.` schema.

#### Partitioned Tables

Electric supports subscribing to [declaratively partitioned tables](https://www.postgresql.org/docs/current/ddl-partitioning.html#DDL-PARTITIONING-DECLARATIVE), both individual partitions and the root table of all partitions.

Consider the following partitioned schema:

```sql
CREATE TABLE measurement (
    city_id         int not null,
    logdate         date not null,
    peaktemp        int,
    unitsales       int
) PARTITION BY RANGE (logdate);

CREATE TABLE measurement_y2025m02 PARTITION OF measurement
    FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');

CREATE TABLE measurement_y2025m03 PARTITION OF measurement
    FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');
```

We create 2 shapes, one on the root table `measurement` and one on the `measurement_y2025m03` partition:

```sh
curl -i 'http://localhost:3000/v1/shape?table=measurement&offset=-1'
curl -i 'http://localhost:3000/v1/shape?table=measurement_y2025m03&offset=-1'
```

The shape based on the `measurement_y2025m03` partition will only receive writes that fall within the partition range, that is with `logdate >= '2025-02-01' AND  logdate < '2025-03-01'` whereas the shape based on the root `measurements` table will receive all writes to all partitions.

### Where clause

Shapes can define an optional where clause to filter out which rows from the table are included in the shape. Only rows that match the where clause will be included.

The where clause must be a valid [PostgreSQL query expression](https://www.postgresql.org/docs/current/queries-table-expressions.html#QUERIES-WHERE) in SQL syntax, e.g.:

- `title='Electric'`
- `status IN ('backlog', 'todo')`

Where clauses support:

1. columns of numerical types, `boolean`, `uuid`, `text`, `interval`, date and time types (with the exception of `timetz`), [Arrays](https://github.com/electric-sql/electric/issues/1767) (but not yet [Enums](https://github.com/electric-sql/electric/issues/1709), except when explicitly casting them to `text`)
2. operators that work on those types: arithmetics, comparisons, logical/boolean operators like `OR`, string operators like `LIKE`, etc.
3. positional placeholders, like `$1`, values for which must be provided alongside the where clause.

You can use `AND` and `OR` to group multiple conditions, e.g.:

- `title='Electric' OR title='SQL'`
- `title='Electric' AND status='todo'`

Where clauses are limited in that they:

1. can only refer to columns in the target row
1. can't perform joins or refer to other tables
1. can't use non-deterministic SQL functions like `count()` or `now()`

When constructing a where clause with user input as a filter, it's recommended to use a positional placeholder (`$1`) to avoid
SQL injection-like situations. For example, if filtering a table on a user id, it's better to use `where=user = $1` with
`params[1]=provided_id`. If not using positional placeholders and constructing where clauses yourself, take care to SQL-escape user input.

See [`known_functions.ex`](https://github.com/electric-sql/electric/blob/main/packages/sync-service/lib/electric/replication/eval/env/known_functions.ex) and [`parser.ex`](https://github.com/electric-sql/electric/blob/main/packages/sync-service/lib/electric/replication/eval/parser.ex) for the source of truth on which types, operators and functions are currently supported. If you need a feature that isn't supported yet, please [raise a feature request](https://github.com/electric-sql/electric/discussions/categories/feature-requests).

> [!Warning] Throughput
> Where clause evaluation impacts [data throughput](#throughput). Some where clauses are [optimized](#optimized-where-clauses).

### Columns

This is an optional list of columns to select. When specified, only the columns listed are synced. When not specified all columns are synced.

For example:

- `columns=id,title,status` - only include the `id`, `title` and `status` columns
- `columns=id,"Status-Check"` - only include `id` and `Status-Check` columns, quoting the identifiers where necessary

The specified columns must always include the primary key column(s), and should be formed as a comma separated list of column names &mdash; exactly as they are in the database schema. If the identifier was defined as case sensitive and/or with special characters, then you must quote it.

## Subscribing to shapes

Local clients establish shape subscriptions, typically using [client libraries](/docs/api/clients/typescript). These sync data from the [Electric sync engine](/products/postgres-sync) into the client using the [HTTP API](/docs/api/http).

The sync service maintains shape subscriptions and streams any new data and data changes to the local client. In the client, shapes can be held as objects in memory, for example using a [`useShape`](/docs/integrations/react) hook, or in a normalised store or database like [PGlite](/products/pglite).

### HTTP

You can sync shapes manually using the
<a href="/openapi.html#/paths/~1v1~1shape~1%7Btable%7D/get"
    target="_blank">
<code>GET /v1/shape</code></a> endpoint. First make an initial sync request to get the current data for the Shape, such as:

```sh
curl -i 'http://localhost:3000/v1/shape?table=foo&offset=-1'
```

Then switch into a live mode to use long-polling to receive real-time updates:

```sh
curl -i 'http://localhost:3000/v1/shape?table=foo&live=true&offset=...&handle=...'
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
  url: `http://localhost:3000/v1/shape`,
  params: {
    table: `foo`,
  },
})
const shape = new Shape(stream)

// Returns promise that resolves with the latest shape data once it's fully loaded
await shape.rows
```

You can register a callback to be notified whenever the shape data changes:

```ts
shape.subscribe(({ rows }) => {
  // rows is an array of the latest value of each row in a shape.
})
```

Or you can use framework integrations like the [`useShape`](/docs/integrations/react) hook to automatically bind materialised shapes to your components.

See the [Quickstart](/docs/quickstart) and [HTTP API](/docs/api/http) docs for more information.

## Throughput

Electric evaluates [where clauses](#where-clause) when processing changes from Postgres and matching them to [shape logs](/docs/api/http#shape-log). If there are lots of shapes, this means we have to evaluate lots of where clauses. This has an impact on data throughput.

There are two kinds of where clauses:

1. [optimized where clauses](#optimized-where-clauses): a subset of clauses that we've optimized the evaluation of
1. non-optimized where clauses: all other where clauses

With non-optimized where clauses, throughput is inversely proportional to the number of shapes. If you have 10 shapes, Electric can process 1,400 changes per second. If you have 100 shapes, throughput drops to 140 changes per second.

With optimized where clauses, Electric can evaluate millions of clauses at once and maintain a consistent throughput of ~5,000 row changes per second **no matter how many shapes you have**. If you have 10 shapes, Electric can process 5,000 changes per second. If you have 1,000 shapes, throughput remains at 5,000 changes per second.

For more details see the [benchmarks](/docs/reference/benchmarks#_7-write-throughput-with-optimized-where-clauses) and [this blog post](/blog/2025/08/13/electricsql-v1.1-released) about our storage engine.

### Optimized where clauses

We currently optimize the evaluation of the following clauses:

- `field = constant` - literal equality checks against a constant value.
  We optimize this by indexing shapes by their constant, allowing a single lookup to retrieve all
  shapes for that constant instead of evaluating the where clause for each shape.
  Note that this index is internal to Electric and unrelated to Postgres indexes.
- `field = constant AND another_condition` - the `field = constant` part of the where clause is optimized as above, and any shapes that match are iterated through to check the other condition. Providing the first condition is enough to filter out most of the shapes, the write processing will be fast. If however `field = const` matches for a large number of shapes, then the write processing will be slower since each of the shapes will need to be iterated through.
- `a_non_optimized_condition AND field = constant` - as above. The order of the clauses is not important (Electric will filter by optimized clauses first).

> [!Warning] Need additional where clause optimization?
> We plan to optimize a much larger subset of Postgres where clauses. If you need a particular clause optimized, please [raise an issue on GitHub](https://github.com/electric-sql/electric) or [let us know on Discord](https://discord.electric-sql.com).

### Row filtering

We use [row filtering](https://www.postgresql.org/docs/17/logical-replication-row-filter.html) where possible to reduce the amount of data sent over the replication stream. Based on the active shapes and their where clauses, we can determine which rows should be included in the replication stream to be filtered directly in Postgres.

When using custom data types in where clauses, like enums or domains, row filtering at the replication level [is not available](https://www.postgresql.org/docs/17/sql-createpublication.html#:~:text=The%20row%20filter%20allows%20simple%20expressions%20that%20don%27t%20have%20user%2Ddefined%20functions%2C%20user%2Ddefined%20operators%2C%20user%2Ddefined%20types%2C%20user%2Ddefined%20collations%2C%20non%2Dimmutable%20built%2Din%20functions%2C%20or%20references%20to%20system%20columns.), and thus all changes will be sent over the replication stream for the relevant tables.

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

### Immutable

Shape definitions are currently immutable.

Once a shape subscription has been started, its definition cannot be changed. If you want to change the data in a shape, you need to start a new subscription.

You can upvote and discuss adding support for mutable shapes here:

- [Editable shapes #1677](https://github.com/electric-sql/electric/discussions/1677)

### Dropping tables

When dropping a table from Postgres you need to _manually_ delete all shapes that are defined on that table.
This is especially important if you intend to recreate the table afterwards (possibly with a different schema) as the shape will contain stale data from the old table.
Therefore, recreating the table only works if you first delete the shape.

Electric does not yet automatically delete shapes when tables are dropped because Postgres does not stream DDL statements (such as `DROP TABLE`) on the logical replication stream that Electric uses to detect changes. However, we are actively exploring approaches for automated shape deletion in this [GitHub issue](https://github.com/electric-sql/electric/issues/1733).
