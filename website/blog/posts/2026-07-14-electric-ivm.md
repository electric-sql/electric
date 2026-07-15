---
title: "Rebuilding Electric on DBSP and Durable Streams"
description: "An experimental version of Electric built on DBSP, an incremental view maintenance engine, with flat memory usage and full protocol conformance."
excerpt: >-
  We've built an experimental version of Electric on DBSP, an incremental view
  maintenance engine. It keeps resident memory flat as the database grows, and
  passes the same conformance tests as production Electric. Here's why we
  built it and how it works.
authors: [balegas]
tags: [electric, dbsp, ivm, durable-streams]
image: /img/blog/electric-ivm/header.png
outline: [2, 3]
post: true
published: true
---

Electric is a [Postgres](https://www.postgresql.org/) sync engine that [streams database changes to millions of concurrent users in real time](https://electric-sql.com/blog/2024/12/10/electric-beta-release#scalable).

Our vision is for any part of an application to declare the data it needs and have Electric sync the result on demand and keep it updated as the database changes. The system should do this across hundreds of thousands of live queries, fanning updates out to millions of clients through the CDN, with single-digit-millisecond latency.

Today, Electric's core primitive is the [shape](https://electric-sql.com/docs/guides/shapes): a partial replica of a table, selected with a `WHERE` clause and kept current from Postgres's logical replication stream. That model has carried Electric a long way: [into GA](https://electric-sql.com/blog/2025/03/17/electricsql-1.0-released), through [a storage engine rebuilt for 100x faster writes](https://electric-sql.com/blog/2025/08/13/electricsql-v1.1-released), and into production at companies processing tens of thousands of changes per second.

Our strategy has been to add more expressive queries to the engine one by one, making sure each is performant and scalable — but it means hand-rolling an implementation for each one, and each richer query carries more state that the engine has to maintain per shape.

We built an experimental version of Electric to test a different approach, one that supports generalized queries. It uses [DBSP](https://docs.rs/dbsp), a query engine based on incremental computation, and [Durable Streams](https://electric-sql.com/blog/2025/12/09/announcing-durable-streams), which give a clean separation between the read and write paths so they can scale independently. The prototype passes the same protocol conformance tests as production Electric and keeps resident memory independent of database size — it scales with live shapes (a few KiB each) rather than with the data.

> [!Warning] ✨ Try it now
> There's no hosted instance yet — clone the [repository](https://github.com/balegas/electric-ivm) to run it yourself, or see a preview on the [demos page](/sync/demos/electric-ivm-linearlite).

## Shape expressiveness

Electric's model lets any client create any shape on demand: a client requests a shape it hasn't seen before, and the engine starts maintaining it from that point onward.

For a simple `WHERE` clause, the state needed to do that is small. The engine mainly needs to determine whether an incoming row change belongs to the shape.

Richer queries need more bookkeeping. Shapes with subqueries track the values that affect membership, and have to handle bulk changes over their indexes when data enters or leaves scope.

Shapes are typically scoped by users and query parameters. If query state is attached directly to each shape, memory grows with the number of users rather than with the underlying data. Decoupling the two means sharing state across shapes — and shared state with operators over it starts to look like a dataflow graph. This is not a new problem: there is an established body of work on incremental computation, and we built the prototype on it.

In fact, this class of engine already powers the client side of the stack: TanStack DB's live queries run on [differential dataflow](http://michaelisard.com/pubs/differentialdataflow.pdf), through [d2ts](https://github.com/electric-sql/d2ts), our TypeScript implementation of it. The prototype brings the same type of approach to the server.

## Incremental queries

DBSP is an incremental view maintenance engine, based on a [theory of incremental computation](https://www.vldb.org/pvldb/vol16/p1601-budiu.pdf) that covers the full relational algebra. Instead of rerunning a query when its inputs change, it takes the input changes and computes the corresponding changes to the result.

In DBSP, queries are expressed as a circuit: a dataflow graph whose nodes are relational operators — filters, joins, aggregates — and whose edges carry changes between them. The prototype compiles its queries into one circuit, built in advance. Incoming Postgres changes flow through the operators, and the circuit emits result deltas.

Many different live shapes can read from the same node without forcing a copy of its computation. Serving many live shapes from one computed relation is a matter of routing its deltas to the ones they affect, not recomputing the query per shape — which is the property Electric needs: many parameterized queries sharing the same maintained indexes and aggregates, while each individual live shape stays lightweight.

> [!Note] Z-sets in 60 seconds
> DBSP represents a collection of rows as a **Z-set**: each row carries a signed integer weight.
>
> An insert is the row with weight `+1`. A delete is the same row with weight `-1`. An update is a retraction of the old row followed by an insertion of the new one.
>
> Say a shape is watching `issue WHERE project_id = 4`. Its Z-set is just this list of rows, each at weight `+1`:
> ```
> (101, "Fix login bug",     project 4)  +1
> (102, "Update docs",       project 4)  +1
> (103, "Investigate crash", project 4)  +1
> ```
>
> Insert issue 104 into project 4, and the delta is one line: `(104, "Add dark mode", project 4) +1` — the shape's Z-set now has four rows. Move issue 102 out to project 7, and the delta is `(102, "Update docs", project 4) -1`: the shape doesn't get rebuilt, it just drops the row that no longer belongs. A `COUNT(*)` watching the same rows would see those same two deltas and add `+1`, then `-1`, to its running total — 3, then 4, then 3 — instead of rescanning `issue` on every write.

## Capture, maintain, deliver

The prototype separates Electric into three components. Each handles one part of the sync path: capturing committed database changes, maintaining query results, and delivering those results to clients.

### The WAL tailer

The WAL tailer consumes Postgres logical replication through `pgoutput`.

It buffers each transaction until commit, stamps the transaction with its commit position, and appends the complete transaction to one ordered changes log. Only after that append is durable does it acknowledge Postgres.

If the process crashes before acknowledging a transaction, Postgres sends the full transaction again after restart. The downstream engine therefore sees complete committed transactions, with possible re-delivery rather than silent loss.

### The query engine

The query engine converts each committed transaction into Z-set deltas and decides which shapes they affect.

Simple shapes never touch the circuit. A shape that matches by equality — `project_id = 4` — is served by a stateless filter: the engine computes the changed row's key and looks up the shapes registered on it, an index lookup rather than a scan. There's no query state to maintain, only routing metadata, and the cost doesn't grow with the number of shapes.

Shapes with subqueries or aggregations are served by the circuit. The circuit maintains the relations those queries depend on — subquery membership, counts per group — and emits a delta only when one of them changes. The engine matches the circuit's output against the shapes registered on that node and appends the result to their logs.

DBSP circuits are static. Their structure is fixed when compiled, and changing the set of queries means recompiling — the opposite of Electric's sync-any-shape model, where a client can ask for a shape the engine has never seen before. What closes that gap is something we've observed from running Electric in production: applications have few distinct queries. What changes from shape to shape is the scope — different parameters for the same query, not the query itself — so a new shape is a new registration on an existing node of the circuit, not new structure. The circuit only changes, and only gets recompiled, when the application's own queries change, which happens sporadically and can evolve with migrations. TanStack DB on the client offers expressive queries and can be used to do last-mile filters of the synced data.

![Schematic of a subquery write: a small always-on DBSP circuit tracks which projects each user can see and reports only when that changes; everything else — fetching the affected issues, checking them against the shape's filter, and making sure only real changes go out — is regular code, not the circuit](/img/blog/electric-ivm/subquery-pipeline.svg)

Take `issue WHERE project_id IN (SELECT id FROM project WHERE user_id = ?)` — "issues in my projects." Instead of one pipeline per user, the circuit keeps a single running answer to which projects each user can see, shared by everyone asking that kind of question. When someone joins or leaves a project, the circuit reports only the one thing that changed: this user can now see that project, or can't anymore. The engine turns that signal into the row-level difference for each shape it affects.

Once a delta lands in a shape's log, delivering it to clients is a separate concern — that's the fan-out.

### The fan-out

Each shape is delivered as a [Durable Stream](https://electric-sql.com/blog/2025/12/09/announcing-durable-streams): a persistent, addressable, append-only log with its own URL. Clients can read the log from any position, tail it for live updates, and resume from where they left off after a disconnect.

When a live shape starts, its initial rows are read from Postgres. The snapshot is fenced against live replication so subsequent deltas continue from the correct point. From then on, matched changes are appended to the shape's stream and clients apply them to a local collection.

Durable Streams are served over plain HTTP and can be cached through CDNs. This lets Electric fan a maintained result out to large numbers of clients without making the query engine hold one connection or one copy of the data for each client.

A consequence of the design is that the hot path holds no complete copy of the source tables. Initial rows come from Postgres, ongoing changes flow through the circuit, and the state that remains — counts per group, subquery membership, which rows a shape currently holds — is bounded by what's distinct, not by the size of the source tables. Resident memory is used for active work and routing rather than for a full in-memory replica of the database.

<!-- Benchmark figures below are from the dbsp-ds repo: docs/bench/memory-matrix-blogpost.md and docs/bench/shape-memory-scale.md (engine at the feed-relations + disk-spilling merges, PR #34–#37). Reproduce commands are in those files. -->

## What we've landed with this engine

### Protocol conformance

The prototype passes the same oracle test suite as production Electric.

The suite checks that the deltas received by a client converge to the correct query result under concurrent writes, restarts and re-deliveries.

### Memory scales with live shapes, not with data

>  Comment: I'm gonna reduce the cost per shape

We pushed the engine on a fixed 100k-issue deployment as the number of live shapes grows from zero to 50,000 — a mix of personal shapes (a permissions subquery scoped to one user) and shared ones (a project board many users watch unmodified), modeled on a LinearLite-style deployment with up to 10,000 users:

| live shapes | engine footprint |
|---:|---:|
| 0 | 10 MiB |
| 500 | 93 MiB |
| 5,000 | 142 MiB |
| 50,000 | 789 MiB |

That's about **16 KiB of state per live shape** at the top end — on the *same* dataset throughout, so every MiB here is the audience, not the data. (Separately, at smaller scale, we confirmed the other half of this claim: the same set of live shapes costs about the same whether the underlying table holds 1,000 or 100,000 rows.)

None of this is optimized yet. Circuit state can already spill to disk past a bounded cache — measured, not just theoretical — but it recovers only about a fifth of footprint at this scale, because the dominant remaining cost is per-shape host metadata, not circuit state. That metadata is built from generic hash-based structures today; swapping those for roaring bitmaps — a compressed representation built for exactly this kind of per-key membership tracking — is the next lever to pull.

### Server-side aggregations

Aggregations are one of the most requested capabilities for shapes: a shape whose result is a computed value rather than a set of rows. The canonical example is showing the total number of issues without syncing the entire `issues` table — today that means a separate API call that drifts out of step with the synced data.

The prototype supports this as a new type of shape, maintained incrementally by the circuit. For example:

```sql
SELECT project_id, count(*) AS issue_count
FROM issues
GROUP BY project_id;
```

An inserted issue increments one group. A deleted issue decrements one group. Moving an issue between projects updates two groups. The engine does not rescan the full `issues` table for each change.

This is the kind of result Electric needs to support its broader vision: the application asks for the total it needs, Electric maintains it, and the client receives updates without syncing all of the underlying rows.

<!-- TODO: confirm final wording for delivery of aggregate results through the shape protocol. -->

## Closing the gap between server and client state

This experiment set out to answer one question: can an IVM engine give Electric more expressive queries without compromising memory usage? We demonstrated it with two concrete extensions: porting subquery membership onto the new engine, and adding aggregations as a new kind of shape entirely. Both pass the same conformance test suite as production Electric, and resident memory stays flat as the database grows.

On the client, [TanStack DB](https://tanstack.com/db) already runs arbitrary live queries over synced collections through [query-driven sync](https://tanstack.com/blog/tanstack-db-0.5-query-driven-sync) — the application's own query decides what gets loaded. The more of that query the server can maintain, the less the client has to over-sync and compute itself, which is exactly the gap general query support on the backend closes.

More importantly, it changes where Electric pays for query expressiveness. Query state is shared and stays bounded by what's distinct — groups, subquery membership, actively synced rows — rather than by the size of the source tables, while each live shape adds only routing and delivery metadata. That is the scaling model the vision needs: expressive queries driving sync, across hundreds of thousands of live shapes, fanned out to millions of clients through the CDN.

There is a lot of work between this experiment and production Electric. But it gives us a credible path from syncing filtered table rows to syncing the live query results an application needs.

IVM's whole model — take input changes, compute output changes — lines up naturally with what a replication stream already gives you: a stream of row changes, not a table to diff. That fit is a big part of why this direction feels right for Electric specifically, not just IVM in the abstract.

## Try it now

Don't take our word for it — go break it. The prototype ships with an interactive pipeline visualizer: create a shape, write to Postgres, and watch the change propagate through the circuit — filters, joins, aggregates, subquery membership — down to the shape's stream, live. There's no hosted instance to click into — clone the [repository](https://github.com/balegas/electric-ivm) and run LinearLite and the visualizer side by side against your own Postgres; the [demos page](/sync/demos/electric-ivm-linearlite) has a preview of what you'll see. It's the fastest way to build an intuition for how this differs from Electric's current shape engine.

The code is all in the [repository](https://github.com/balegas/electric-ivm): the engine, the conformance suite, and the visualizer itself. Clone it, point it at your own Postgres, and see what breaks.

***

- [Read the repository](https://github.com/balegas/electric-ivm)
- [See the LinearLite demo](/sync/demos/electric-ivm-linearlite)
- [Read the Durable Streams docs](/docs/sync/)
- [Join the Discord](https://discord.electric-sql.com)

<div class="actions cta-actions page-footer-actions left">
  <div class="action cloud-cta">
    <VPButton
        href="https://github.com/balegas/electric-ivm"
        text="Read the repo"
        theme="brand"
    />
    &nbsp;
    <VPButton
        href="/sync/demos/electric-ivm-linearlite"
        text="See the demo"
        theme="alt"
    />
    &nbsp;
    <VPButton
        href="https://discord.electric-sql.com"
        text="Discord"
        theme="alt"
    />
  </div>
</div>
