---
title: "Introducing Electric Circuits"
description: "The missing layer between your database and your app: live queries maintained incrementally and delivered over Durable Streams."
excerpt: >-
  Electric Circuits is a new primitive that turns any static database query
  into a live version of it. A query statement is compiled into a circuit — an
  incremental computation graph — that pipes database changes to the live
  queries they affect, without duplicating state.
authors: [balegas]
tags: [electric, circuits, dbsp, ivm, durable-streams]
image: /img/blog/electric-circuits/header.png
outline: [2, 3]
post: true
published: true
---

<script setup>
import MemoryMatrixChart from '../../src/components/MemoryMatrixChart.vue'
</script>

Electric Circuits is a new primitive that turns any static database query into a live one. Declare a query in the application and its result set stays updated in realtime as changes happen on the database.

Electric Circuits builds on the [theory of incremental view maintenance](https://www.vldb.org/pvldb/vol16/p1601-budiu.pdf) (IVM), an approach to building a query engine that applies changes to a query result, rather than recomputing it from scratch. Beneath the query engine, [Durable Streams](https://electric-sql.com/blog/2025/12/09/announcing-durable-streams) deliver every change to clients.

Electric Circuits provides end-to-end fine-grained reactivity at the precision of what's being rendered on screen. It is built on well-established open-source libraries, and it has full-compatibility with the Electric protocol.

> [!Warning] ✨ Research preview
> Electric Circuits is a research preview. Checkout the [repository](https://github.com/balegas/electric-ivm) and try the circuit visualizer.

## From static to live queries

Applications and agents need their local state updated the moment the database changes. When state does not update reactively, the result is a poor user experience and, worse, users and agents make decisions on stale data.

Adding live data on top of a static API means working around its limitations: tracking the difference between one query result and the next by long-polling, and putting a caching layer in front of the database to keep that polling from overwhelming it.

The alternative is a reactive API. An application declares the data it wants to keep live; the backend observes every change committed to the database and fans it out to the live queries it affects. Electric and others have shaped a category of software specialized in exactly this: the sync engine.

The tension in a sync engine is granularity. Broad live queries are cheap to maintain but over-sync, delivering more data than a client needs. Fine-grained queries sync precisely what a client wants but require keeping more internal state to determine the changes that affect the query.

## Electric Circuits

An Electric Circuit maintains a SQL query as a live result: register a query and its result set stays updated as the database changes, without re-running it. The circuit is an incremental computation graph — changes flow from the database, through the graph, and out to the registered live queries they affect.

Electric Circuits uses [DBSP](https://docs.rs/dbsp), an incremental view maintenance engine, to build the computation graphs. A circuit is built once per query statement, so queries with the same statement but different parameters share one circuit — the de-duplication of state is what lets a circuit serve many users without memory exploding. Internal indexes spill to disk, which keeps memory bounded as the data set grows.

On the client, [TanStack DB](https://tanstack.com/db) offers the same expressive, incremental query model, so a component can filter, join and aggregate over multiple collections of synced circuits. The component's query drives what the server syncs, closing the gap between what a client asks for and what the server sends over the wire.

Incremental view maintenance is established technology. [Materialize](https://materialize.com/) and [Feldera](https://www.feldera.com/) apply it to the data warehouse, where it replaces the cost of re-running analytical queries over large data sets on every change. Electric Circuits applies the same technology to the application, delivering reactive state to clients over Durable Streams.

## How it works

You declare a live query by making a POST request to the API, similarly to Electric's [shape API](https://electric-sql.com/docs/guides/shapes). The engine compiles it into a circuit; database changes flow through, and only those affecting the query's result are appended to its log. The client tails that log, applying changes to the application state as they arrive.

```sh
curl -s -X POST http://localhost:8790/shapes \
  -H 'content-type: application/json' \
  -d '{
    "table": "issues",
    "where": {
      "col": "project_id",
      "in": { "table": "project_members", "project": "project_id",
              "where": { "col": "user_id", "op": "eq", "value": 42 } }
    }
  }'
```

### The query becomes a circuit

[DBSP](https://docs.rs/dbsp) internally represents data as **Z-sets** — collections where every row carries a signed weight. A row is visible in a collection while its weight is positive. Changes are Z-sets too: an insert is the row at `+1`, a delete at `−1`, and an update is broken into a delete and an insert — so maintaining a query costs the size of the change, not the size of the database.

DBSP provides a range of operators that compose to represent any relational algebra expression as a dataflow. Stateless operators — filters, projections — transform each change as it passes through, remembering nothing. Stateful operators remember just enough to process the next change without re-reading the database: a join keeps an index of the rows each side has seen; a distinct keeps a count per value, so it knows when a value first appears — and when its last contributor disappears.

The query above compiles to this:

![The Electric Circuit for a subquery](/img/blog/electric-circuits/subquery-pipeline.svg)

Logical replication feeds the change stream (**Δ**) per table to the circuit. The subquery runs along the `project_members` branch: a filter (**σ**) narrows the stream to user 42's memberships, and a **distinct** maintains the *inner set*. Every `issues` change is matched against user project membership (**⋈**); a projection (**π**) turns a match into a change envelope, appended to the live query's stream.

A membership flip results in  bulk data changes. If a user enrolls on a new project, the issues of that project must now **move in** to the live query. On a move-in, the engine runs one indexed query against Postgres (`WHERE project_id = …`) and streams the rows in as upserts. On a move-out, e.g. user leaves project,  it doesn't read the database at all — it already knows which keys the query was serving, and emits their deletes directly.

A second live query with the same statement and different parameters reuses the existing circuit. Parameters flow through it as *data*, without changing the graph structure. This de-duplication of state is what lets the engine scale independently of the number of live queries.

### Circuits hold no rows

The circuit holds only *keys* — the inner set of project ids, the membership decision — never a copy of your issues. Rows live in Postgres, which stays the source of truth; the engine fetches them only for an initial query, or on the move-ins above. The trade is one indexed read at those moments, in exchange for memory that tracks the size of your live queries, not the size of the database — and established live queries in the streaming phase never pay it.

## Building on established foundations

Electric Circuits is our continuation of [turning the database inside out](https://martin.kleppmann.com/2015/03/04/turning-the-database-inside-out.html). [Durable Streams](https://electric-sql.com/blog/2025/12/09/announcing-durable-streams) store data in logs; [StreamDB](https://electric-sql.com/blog/2026/03/26/stream-db) turns those logs into a database; Circuits make that database expressive.

A Durable Stream is an addressable, append-only log that a client can read from any offset and resume after a disconnect. It carries whatever a producer appends to it; deciding what to write is left to the application.

StreamDB turns a set of durable streams into a reactive database: declare a schema, and the streams materialise into typed collections that stay fresh as events arrive. But it is coarse-grained — it works at the schema level, so a client syncs whole schemas before it can query the data.

Circuits are the fine-grained, expressive counterpart. A circuit is a query engine that tails a replication stream, maintaining only the data a query needs and back-filling from the database when data is missing. It brings the expressiveness of SQL — filters, subqueries, aggregations — to data that lives in logs.



## What we've shipped

The research preview ships the engine and three things around it: an extension of the API for live aggregations, a visualizer that shows a running circuit maintaining its queries, and benchmarks that put numbers on the memory model.

# Support for aggregations

Aggregations are one of the most requested features from Electric users. The Electric protocol syncs rows and has no notion of a maintained scalar, so they're the one place we extend the API beyond `/v1/shape` — a live `count`, `sum`, `avg`, `min` or `max` over a filtered set, created the same way you create a live query and read from the same kind of stream:

```sh
curl -s -X POST http://localhost:8790/aggregate.create \
  -H 'content-type: application/json' \
  -d '{
    "table": "issues",
    "fn": "sum",
    "col": "points",
    "where": { "col": "status", "op": "neq", "value": "done" }
  }'
```

The feed carries a single row — `{ value, n }`, the aggregate and the number of matching rows — re-emitted only when a change moves it. All five functions are supported as a scalar over a predicate; the `where` takes filters and boolean logic (no subqueries), and there is no `GROUP BY` yet.

The pipeline is the same idea as the subquery, one operator shorter. A filter (**σ**) selects the matching rows, then an incremental **fold** accumulates them into the scalar: each delta nudges the running value — a `+1` on a row adds its `points`, a `−1` subtracts them — so the fold never re-scans the set. `min`/`max` keep a small ordered tally of the values behind the current extreme, so deleting the current minimum emits the next one instead of recomputing. And like every circuit, identical aggregations are shared — any number of dashboards on the same live count tail one fold and one feed.

### The circuit visualizer

The **circuit visualizer** is a learning tool for how circuits work. It shows the shapes currently defined on the engine and the circuit that maintains them — every table source, filter, join and aggregate node. You can define new shapes, write to the database, and see each change move through the circuit to the shapes it updates: the affected nodes flash and the edges pulse as the delta travels. It has two views — a logical view of the query graph, and the underlying DBSP circuit — and an activity log to replay changes one at a time.

### Benchmarks

The memory model above makes three testable claims: state is de-duplicated across queries that share a statement, memory tracks the size of your live queries rather than the size of the database, and internal state stays bounded as data grows. We measured all three on the LinearLite schema, seeded at three deployment sizes (1k, 10k and 100k rows), with simulated user sessions each opening ten live queries — a visibility subquery, board-column filters, per-issue comment queries — up to 10,000 registered live queries.

<MemoryMatrixChart
  title="Registration only"
  subtitle="Engine RSS as live queries register; one bar per deployment size"
  :data="[
    { label: '1k rows', data: [24.5, 33.5, 38.4, 53.3, 94.0], color: '#75fbfd' },
    { label: '10k rows', data: [24.6, 33.4, 39.4, 56.7, 109.5], color: '#f59e0b' },
    { label: '100k rows', data: [24.3, 33.5, 38.9, 56.5, 110.3], color: '#a855f7' }
  ]"
  :labels="['0', '1,000', '2,500', '5,000', '10,000']"
  :height="360"
/>

<MemoryMatrixChart
  title="Fully materialized"
  subtitle="Same run with every result backfilled — the visible-row key sets"
  :data="[
    { label: '1k rows', data: [24.5, 34.1, 39.6, 55.3, 98.0], color: '#75fbfd' },
    { label: '10k rows', data: [24.6, 43.2, 48.8, 68.9, 121.7], color: '#f59e0b' },
    { label: '100k rows', data: [24.5, 156.8, 193.1, 217.6, 248.3], color: '#a855f7' }
  ]"
  :labels="['0', '1,000', '2,500', '5,000', '10,000']"
  :height="360"
/>

**De-duplication holds.** The 10,000 live queries span three query statements, and the engine builds exactly three circuits — the same count at 100 queries as at 10,000. Each additional registration costs **7–9 KiB**, flat across deployment sizes.

**Memory tracks live queries, not the database.** Idle, the engine sits at 24.5 MiB at every deployment size. With 10,000 live queries registered, growing the dataset 100× moves memory from 94 MiB to just 110 MiB — at every step of the first chart, the three bars are near-identical. The one data-linked term is exactly the one the model predicts, visible in the second chart: the keys of rows currently visible through a result, at **~2 bytes per visible row** (18 MiB of accounted state for ~12 million tracked rows when every query is fully materialized) — the key in a bitmap, never the row.

**Bounded stays bounded.** A circuit's internal indexes — the operator state DBSP keeps to decide membership incrementally — live behind a disk-backed cache: hot state stays in memory under an explicit budget (64 MiB by default) and the rest spills to disk. Worst-case memory is a configuration knob, not an emergent property of the workload.

_Measured on a single node at commit `515ecc1`; full tables and methodology in the repository's `docs/bench/`._

## The data layer for AI-era software (TODO)

<!-- L2 — kicker, 2–3 sentences, no summary -->

- Agents don't sit on connection pools; they read and write logs.
- Library mode is already a second producer — this is demonstrated, not roadmap.
- Circuits make accumulated agent state, and your database, queryable and live.

## Try it now

<!-- reused nearly verbatim from the electric-ivm draft -->

- Go break it: create a query, write to Postgres, watch the change propagate through the circuit down to the stream.
- No hosted instance — clone the repo and run LinearLite and the visualizer against your own Postgres.
- CTA buttons: repo · demo · Discord.
