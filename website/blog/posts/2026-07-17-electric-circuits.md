---
title: "Electric Circuits: turn any database query live"
description: "Electric Circuits turn static database queries into live ones: registered on shared incremental circuits, maintained as the data changes, and delivered over Durable Streams."
excerpt: >-
  Electric Circuits is a new primitive that turns any static database query
  into a live one. Register a query and a circuit — an incremental
  computation graph shared across queries with the same statement — keeps
  its result updated as the database changes, with memory that scales with
  your live queries, not your data.
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

<style scoped>
figure figcaption {
  text-align: center;
  margin: 0.75rem auto 1.5rem;
}
</style>

Electric Circuits is a new primitive that turns any static database query into a live one. Register a query from your application and its result set stays updated in realtime as changes happen on the database.

Electric Circuits builds on the [theory of incremental view maintenance](https://www.vldb.org/pvldb/vol16/p1601-budiu.pdf) (IVM): rather than re-running a query when the data changes, the engine applies each change against the existing result set. Beneath the query engine, [Durable Streams](https://electric-sql.com/blog/2025/12/09/announcing-durable-streams) deliver every change to clients.

Electric Circuits provides end-to-end fine-grained reactivity at the precision of what's being rendered on screen. It is built on well-established open-source libraries, and is fully compatible with the Electric protocol.

> [!Warning] ✨ Research preview
> Electric Circuits is a research preview, functional end to end — everything in this post is runnable today. [Clone the repo](https://github.com/balegas/electric-ivm) and watch your own writes ripple through the circuit in the circuit visualizer.

## From static to live queries

Applications and agents need their local state updated the moment the database changes. The latency results in a poor user experience and, worse, in users and agents making decisions on stale data.

Adding live data on top of a static API means working around its limitations: tracking the difference between one query result and the next by long-polling, and putting a caching layer in front of the database to keep that polling from overwhelming it.

The alternative is a reactive API. An application declares the data it wants to keep live; the backend observes every change committed to the database and fans it out to the live queries it affects. Electric and others have shaped a category of software specialized in exactly this: the sync engine.

The tension in a sync engine is granularity. Broad live queries are cheap to maintain but over-sync, delivering more data than a client needs. Fine-grained queries sync precisely what a client wants but require keeping more internal state to determine the changes that affect the query.

## Electric Circuits

An Electric Circuit maintains a SQL query as a live result: register a query and its result set stays updated as the database changes, without re-running it. The circuit is an incremental computation graph: the engine tails Postgres logical replication, feeds every change through the graph, and delivers the output to the registered live queries it affects over [Durable Streams](https://electric-sql.com/blog/2025/12/09/announcing-durable-streams).

<figure>
  <img src="/img/blog/electric-circuits/architecture.svg" alt="Electric Circuits architecture: Postgres feeds a logical replication tailer, changes flow through the circuits, and each live query result is written to a Durable Stream" />
  <figcaption>
    Electric Circuits architecture.
  </figcaption>
</figure>

The computation graphs are built with [DBSP](https://docs.rs/dbsp), the incremental view maintenance engine from the Feldera project. IVM is established technology: [Materialize](https://materialize.com/) and [Feldera](https://www.feldera.com/) apply it to the data warehouse, where it replaces the cost of re-running analytical queries over large data sets on every change. Electric Circuits applies it to the application, delivering reactive state to clients over Durable Streams.

## How Circuits work

You register a live query by making a POST request to the API, similarly to Electric's [shape API](https://electric-sql.com/docs/guides/shapes). The engine compiles it into a circuit; database changes flow through, and only those affecting the query's result are appended to its log. The client tails that log, applying changes to the application state as they arrive.

```sh
curl -s -X POST http://localhost:8790/shapes \
  -d '{
    "table": "issues",
    "where": {
      "col": "project_id",
      "in": { "table": "project_members", "select": "project_id",
              "where": { "col": "user_id", "op": "eq", "value": 42 } }
    }
  }'
```

### The query becomes a circuit

[DBSP](https://docs.rs/dbsp) internally represents data as **Z-sets** — collections where every row carries a signed weight. A row is visible in a collection while its weight is positive. Changes are Z-sets too: an insert is the row at `+1`, a delete at `−1`, and an update is broken into a delete and an insert — so maintaining a query costs the size of the change, not the size of the database.

DBSP provides a range of operators that compose to represent any relational algebra expression as a dataflow. Stateless operators — filters, projections — transform each change as it passes through, remembering nothing. Stateful operators remember just enough to process the next change without re-reading the database: a join keeps an index of the rows each side has seen; a distinct keeps a count per value, so it knows when a value first appears — and when its last contributor disappears.

The query above compiles to this:

![The Electric Circuit for a subquery](/img/blog/electric-circuits/subquery-pipeline.svg)

Logical replication feeds each table's change stream to the circuit. The subquery runs along the `project_members` branch: a filter narrows the stream to user 42's memberships, and a **distinct** maintains the *inner set* — the project ids the user belongs to. Every `issues` change is matched against that membership. The **projection** is where the circuit meets the log: it transforms the circuit's internal representation of a match — a key and a weight — into the change envelope that is appended to the live query's stream.

A membership flip results in bulk data changes. If a user enrolls in a new project, the issues of that project must now **move in** to the live query; leave the project and they **move out**. In both cases the engine runs one indexed query against Postgres (`WHERE project_id = …`). On a move-in, the rows stream to the client as upserts; on a move-out, a delete is emitted for each key the query was serving.

<figure>
  <video class="w-full" controls loop playsinline poster="/videos/blog/electric-circuits/move-in-out.jpg">
    <source src="/videos/blog/electric-circuits/move-in-out.mp4" />
  </video>
  <figcaption>
    Membership flip: enrolling in a project and leaving.
  </figcaption>
</figure>

### State de-duplication

A second live query with the same statement and different parameters reuses the existing circuit. Parameters flow through it as *data*, without changing the graph structure. This de-duplication of state is what lets the engine scale independently of the number of live queries. Internal indexes spill to disk, which keeps memory bounded as the data set grows.

### Circuits hold no rows

The circuit holds only *keys* — the inner set of project ids, the membership decision — never a copy of your issues. Per-query key sets are compressed [Roaring bitmaps](https://roaringbitmap.org/) — bytes per row, not rows. Rows live in Postgres, which stays the source of truth; the engine fetches them only for an initial query, or when a membership flip moves rows in or out. The trade is one indexed read at those moments, in exchange for memory that scales with the queries you run, not the data you store — and established live queries in the streaming phase never pay it.

## What we've shipped

Electric Circuits is compatible with the Electric protocol and passes Electric's conformance test suite. We've extended Electric's API with aggregations to validate extensibility toward generalized query support, run benchmarks to evaluate memory usage across workload sizes, and built a circuit visualizer to see how the system works internally.

### Support for aggregations

Aggregations are a perfect example of queries that require an expressive query engine on the backend. To compute a single scalar, the query needs to fold the entire data set. That is prohibitive if you have to do the computation on the client: you'd have to sync the entire set of issues, even though your application only shows a few of them on screen.

To register an aggregation:

```sh
curl -s -X POST http://localhost:8790/shapes \
  -d '{
    "table": "issues",
    "fn": "sum",
    "col": "points",
    "where": { "col": "status", "op": "neq", "value": "done" }
  }'
```

The circuit is the same idea as the subquery's. A filter selects the matching rows, then an incremental **fold** accumulates them into the scalar: each delta nudges the running value — a `+1` on a row adds its `points`, a `−1` subtracts them — so the fold never re-scans the set. `min`/`max` keep a small ordered tally of the values behind the current extreme, so deleting the current minimum emits the next one instead of recomputing. And like every circuit, identical aggregations are shared — any number of dashboards on the same live count tail one fold and one stream.

### Benchmarks

The engine's memory model is what makes live queries cheap to operate: a circuit retains keys and counts, never rows, and queries that share a statement share a circuit. Two testable claims follow:

- Memory scales with the number of live queries
- State is de-duplicated across queries that share a statement

We measured both on the LinearLite schema, seeded at three deployment sizes (1k, 10k and 100k rows), with simulated user sessions each opening ten live queries, up to 10,000 registered live queries.

<MemoryMatrixChart
  title="Live query registration"
  subtitle="Engine memory usage by number of registered live queries; one bar per deployment size"
  :data="[
    { label: '1k rows', data: [24.5, 33.5, 38.4, 53.3, 94.0], color: '#75fbfd' },
    { label: '10k rows', data: [24.6, 33.4, 39.4, 56.7, 109.5], color: '#f59e0b' },
    { label: '100k rows', data: [24.3, 33.5, 38.9, 56.5, 110.3], color: '#a855f7' }
  ]"
  :labels="['0', '1,000', '2,500', '5,000', '10,000']"
  :height="360"
/>

**Memory scales with live queries.** At every step of the chart, the three bars are near-identical: idle, the engine sits at 24.5 MiB whether the database holds 1k or 100k rows, and with 10,000 live queries registered, growing the dataset 100× moves memory from 94 MiB to just 110 MiB.

**De-duplication holds.** The 10,000 live queries collapse onto a handful of shared circuits — one per family of queries — and that handful is the same at 100 queries as at 10,000. Registration is the only per-query cost: across the full run, **7–9 KiB per live query** on average. That figure is higher than it needs to be — the circuit state behind it is only ~0.1 KiB per query; the rest is per-stream bookkeeping we haven't optimized yet.

### The circuit visualizer

The **circuit visualizer** is a learning tool for how circuits work. It shows the live queries currently defined on the engine and the circuit that maintains them — every table source, filter, join and aggregate node. You can define new live queries, write to the database, and see each change move through the circuit to the live queries it updates: the affected nodes flash and the edges pulse as the delta travels. It has two views — a logical view of the query graph, and the underlying DBSP circuit — and an activity log to replay changes one at a time.

<figure>
  <video class="w-full" controls loop playsinline poster="/videos/blog/electric-circuits/circuit-vis.jpg">
    <source src="/videos/blog/electric-circuits/circuit-vis.mp4" />
  </video>
  <figcaption>
    Circuit visualizer running.
  </figcaption>
</figure>

## Live context for the agent loop

Agents accumulate their work in logs — messages, tool calls, results — and [Durable Streams are the primitive that holds them](/blog/2026/04/08/data-primitive-agent-loop). An agent's context, however, reaches beyond its own history: it extends into the database, the knowledge base of the domain the agent operates in. Circuits make both queryable and live — the state the loop produces and the data it acts on.

Dynamic and expressive queries are essential characteristics of an API for agents. Sessions evolve, so an agent must be able to compose and hydrate its context autonomously as it discovers what the work needs. And a context window is a hard budget: an agent cannot afford to over-sync, so the filter, the join and the aggregate must run in the database, delivering only the data that is relevant.

## Try it now

Applications and agents need live queries for greater user experience. Electric Circuits is the next generation of live queries: expressive, durable and scalable. Clone the repo and check out the demo app with the circuit visualizer alongside.

One command boots the whole stack:

```sh
git clone https://github.com/balegas/electric-ivm
cd electric-ivm
pnpm install
pnpm demo:linearlite
```



