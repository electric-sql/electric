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

Electric Circuits is a new primitive that turns any static database query into a live version of it. Declare any query in your application and maintain its result set updated with changes on the database in realtime.

Electric Circuits is an experimental prototype. It applies the [theory of incremental view maintenance](https://www.vldb.org/pvldb/vol16/p1601-budiu.pdf), and uses [Durable Streams](https://electric-sql.com/blog/2025/12/09/announcing-durable-streams) to deliver data at scale.  In this blogpost we explain how we've built it and what it delivers.

> [!Warning] ✨ Research preview
> Electric Circuits is a research preview. Checkout the [repository](https://github.com/balegas/electric-ivm) and try the circuit visualizer.

## From static to live queries

Applications and agents need live data. Getting there from a static query means building machinery around it. Fetch a snapshot. Poll for changes and handle cache invalidation. This is difficult to get right and in the end  your application is still laggy due to the amount of hops your data has to go through.

The alternative is a *reactive* model: push changes to clients the moment the result set of the query in the database changes. Now the backend has to match each change to the queries it affects, keep pace with the database's write rate, and fan every change out to all the clients subscribed to it. 

Simple queries like row filters are extremely scalable, but more complex queries like joins, subqueries or aggregations require internal state to decide whether a query is affected by a change. Internal state is typically attached to each client's subscription, which makes it hard to scale.

<!-- L1.A — the trap. Do not restate the lede's third sentence; unpack it. -->
<!-- Guardrail: don't claim every other system fails. State the mechanism, not a verdict. -->

## Electric Circuits

An Electric Circuit maintains a SQL query as an incremental computation graph. Electric Circuits uses [DBSP](https://docs.rs/dbsp) to build the graphs. DBSP can express full relational algebra and therefore can handle any SQL query. 

We tail Postgres logical replication to feed data into the graoh. Changes are threaded through the graph and fanned out to live queries they affect. Live queries are backed by Durable Streams. Connected clients receive changes immediately over SSE or long-polling. Otherwise, they can resume the stream from the last offset they've seen to catch up or start from the beginning.

In Electric Circuits — as in any incremental computation engine — a query is never re-executed against the full database. The work is proportional to the size of the changes passing through the graph, not to the size of the database. 

Materialize and Feldera have specialized this class of engine for data warehouses, where re-running queries over large data sets on every change is prohibitively expensive. Electric Circuits builds on the same technology to provide reactive state in applications.

<!-- L1.B overview + L2 architecture spine + differentiation beat, all here. No deep IVM. -->
<!-- The diagram excludes the client on purpose and is the reference for the three sections below. -->
<!-- Consequence: there is no longer a late "Where this fits" section. Post goes proof -> kicker -> CTA. -->

## How it work

<!-- move 1 — the core of the post, ~40% of the body -->

[DBSP](https://docs.rs/dbsp) represents data as **Z-sets** — collections where every row carries a signed weight. A table is a Z-set with every row at weight `+1`; a *change* is a Z-set too — a small one, a **delta**: an insert is a row at `+1`, a delete the same row at `−1`, an update is both at once. A row belongs to a collection if the weight is positive.

Every SQL statement can be expressed as a relational algebra expression. In the compilation step we translate a statement into a DBSP circuit that holds the computation of the result set of that expression.

Nodes in a circuit are shared across users, therefore identical queries collapse into one: the same table, predicate, and projection resolve to a single circuit and a single output stream. This is what enable state deduplication and the system to scale the number of live queries gracefully. 

### An example

Here is a query for retrieving issues for all projects a user is member of_

```sql
 SELECT * FROM issues 
 WHERE project_id IN
   (SELECT project_id FROM project_members WHERE user_id = 42)
 ```
This query is compiled into the following circuit:
![The Electric Circuit for a subquery](/img/blog/electric-circuits/subquery-pipeline.svg)

Each source table feeds in its change stream (**Δ**): one for `issues`, one for `project_members`. The subquery runs along the `project_members` branch: a filter (**σ**) keeps only user 42's memberships, and a distinct (**δ**) maintains the *inner set* — the project ids user 42 belongs to, a handful of keys, never any issues. That inner set is the only state the pipeline keeps.
 
Every `issues` change meets that inner set at a membership join (**⋈**): if the issue's `project_id` is in the set, it belongs in the result. A projection (**π**) turns it into a change envelope, appended to the query's stream (the **sink**). Add user 42 to a project and its id enters the inner set at **δ**; remove them and it leaves — and the join re-decides who sees what, incrementally, without ever re-running the query.
 
So the pipeline holds only *keys* — the inner set of project ids and the membership decision — never a copy of your issues.

### Circuits hold no data

Circuits hold only data keys. Rows live in the server and fetched to server initial queries or when the visibility of data changes for a query (e.g. the subqueries example discussed above). Postgres remains the source of truth and the circuits memory efficient. The trade is slightly higher latency of querying Postgres to get data when is missing for an initial query or handle membership change, but that doesn't affect established live queries that are in the live streaming phase.

<!-- The lede says a query is compiled into a circuit. This section is where that resolves: the KIND compiles, the instances register. Must read as depth, not correction. -->
<!-- Guardrail: never state or imply that aggregate groupings register dynamically today. -->
<!-- Open: without benchmark numbers in the post, the "sized by kinds, not instances" claim carries the scalability argument on its own. -->

## Reactivity end-to-end

Reactivity doesn't stop at the server. When data is delivered into the client, it can be piped to TanStack DB  where last-mile filters and further live queries run client-side, without another round trip. The server maintains what's shared between clients; the client computes what's personal to one. One reactive model, all the way from the WAL to the UI.

Electric circuits with a rich queries can reduce the gap between the data that is synced to the client and the data that the client actually needs. 

<!-- Guardrail: CDN fan-out is architecturally natural but NOT wired up in the prototype. Direction, never a demo claim. -->

## The database, inside out

[StreamDB](https://electric-sql.com/blog/2026/03/26/stream-db) turned a Durable Stream into a reactive database: declare a schema and the stream materializes into typed collections that stay current as events arrive. What it didn't give you was a way to decide what goes into the stream in the first place. Filtering changes into the streams that need them was application code — written by hand, one path per query, and maintained by you. Electric Circuits makes it expressible: the query statement defines the stream. Write SQL, and the circuit routes each change to the streams whose results it affects. Fetching, polling, invalidating, routing — all of it was code you wrote to keep a static query current. With Circuits, that code is the query.

## What we've landed (TODO)

<!-- proof — bullets, dense, not prose. Benchmark numbers are OUT of this post. -->

- Expressive queries maintained server-side: subquery membership and aggregations, on one engine.
- Runs production Electric's own conformance oracle; a sibling suite covers concurrency, engine restarts and resume.
- Server-side aggregations: `COUNT(*)` per group is circuit-maintained; SUM/AVG/MIN/MAX are incremental folds, no rescans.
- Run it yourself: interactive circuit visualizer and a LinearLite demo.

<!-- Open: with the numbers out, this section proves correctness and capability but not scale. The lede's "scalable" is now carried by the argument in "Introducing Electric Circuits" alone. -->

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
