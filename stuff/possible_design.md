Summary from ChatGPT chat:

Below is a consolidated overview of everything we covered, organized as a “mini design doc” so you can refer back to it.

---

## 1) Your target system and constraints

You’re building a **SQL-like live query engine** fed by a **Postgres logical replication/WAL stream (LSN-ordered)** plus other sources.

Key properties:

- The computation is a **graph** (not a single pipeline). Multiple “pipelines” map onto a **shared graph** to reuse state.
- The graph is **mutated by new queries** (add/remove inputs/nodes/outputs), but **data change flow is continuous** (no per-update topology changes).
- Messages flow **downstream and upstream** (your “up-query” model from Jon’s thesis).
- Requirements:
  - **low latency**, low tail latency
  - **low memory**
  - **avoid memory copies** in the hot path (especially big payload copies)
  - **scale across all CPU cores**
  - each operator/node should be **single-threaded and core-confined** (“actor-ish”), with smart placement/sharding.

You’ve used Elixir before, but you want more explicit memory control → leaning **Rust or Go**.

---

## 2) The pivotal insight: you can’t avoid progress tracking

Even if you don’t want “time” in the Timely/Differential sense, you still need a notion of **progress/completeness** to make:

- joins correct “as of LSN X”
- “snapshot complete up to LSN X”
- safe **GC of retained history/indexes**

Without this, you either:

- produce transiently incorrect results, or
- keep unbounded history because you can’t prove completeness.

### Minimal progress model that fits your domain

Because your data source is a replication log, you already have a natural scalar:

- **`LSN`** is your “timestamp”.

So the minimal, sufficient primitive is:

- `Frontier(lsn)` on each edge meaning: _no more rows with `row.lsn <= lsn` will arrive on this edge_.

This is the simplest form of watermark. It’s not “wall clock time”, it’s “log progress”.

---

## 3) Your “down + up” message model, cleaned up

### Downstream (data plane)

- `RowUpdate { table, pk, op, lsn, payload_handle }`
- `Frontier { lsn }`

Where `payload_handle` is an `Arc`/`Bytes`/arena reference so forwarding is pointer/refcount, not copying.

### Upstream (“up-queries” / completeness requests)

Conceptually:

- `UpQuery { id, predicate, asked_lsn }`
- `UpQueryResolved { id, resolved_lsn }`

The operator must be able to say:

- “I have produced a complete answer for query `id` up to `resolved_lsn` (≤ asked_lsn)”
- then it can GC any extra retained state that was only needed to answer that request.

This matches your sketch: **retain history until resolved**, then release.

---

## 4) Correctness + GC rules for stateful ops (especially join)

### Why joins force a frontier concept

To emit correct “as-of LSN t” join results, the join needs to know it has seen all matching inputs up to `t`.

A straightforward rule:

- a join can finalize (or declare complete) results for LSN `t` only when:
  - `frontier_left >= t` and `frontier_right >= t`

### What join state must keep

- indexes by join key (and usually by PK)
- enough history to answer:
  - downstream incremental output
  - upstream snapshot/up-query requests

GC policy becomes:

- keep history back to `min_needed_lsn`
- `min_needed_lsn` is driven by:
  - downstream “result consumption frontier”
  - in-flight up-queries’ `asked_lsn` / `resolved_lsn`
  - plus any safety margins you choose

This is basically “arrangement-lite”: not full Differential, but the same fundamental need—**a reusable indexed trace with a GC floor**.

---

## 5) The shared graph vs physical execution across cores

We distinguished:

- **logical sharing**: one logical operator/index reused across many queries
- **physical execution**: sharded/replicated instances across workers/cores

### Physical layouts

- **Replicated stateless ops** (map/filter/project): usually one per worker (or fused).
- **Sharded stateful ops** (join/group/index/history): N shards (one per worker), partitioned by key.
- **Singleton**: avoid unless necessary (final sink/merge), or keep outputs partitioned.

### Cross-core scaling mechanism

Not by scheduling a single operator on multiple cores, but by:

- **partitioning the data** so each shard processes disjoint keys
- routing with an **Exchange/Router** step:
  - `worker = hash(key) % N`

This is how you get:

- single-threaded operator shards
- no locks around join indexes
- predictable memory ownership
- scalable throughput across cores

---

## 6) Go design: “goroutine per operator” (and what it means)

### What it looks like

- operator = goroutine
- edge = channel
- control plane = separate channels / manager goroutine

### Development story (strong)

- very fast iteration
- dynamic topology changes are straightforward (spawn/close/rewire)
- up-queries are ergonomically natural (reply channels / request IDs)

### Where it bites (scalability / latency)

- **channel + select overhead** can dominate for per-row flows through many “thin” operators
- you’ll likely need:
  - batching (send blocks, not rows)
  - operator fusion (combine map/filter/projection)

- **scheduler locality** is weak: hard to guarantee “operator stays on core X”
- **GC becomes the main enemy** in join-heavy systems:
  - per-row allocations → GC churn → tail latency spikes

Go can work, but the discipline tax is: pooling, batching, careful memory layouts, controlling allocations constantly.

---

## 7) Rust design without Timely, and without writing a scheduler

Your goal: “actor-ish core-confined operators” + “don’t build a scheduler”.

The proposed approach:

### Per-core single-thread runtimes

- spawn N OS threads pinned to cores
- each runs a **single-thread executor**
  - e.g. Tokio “current-thread” runtime per core

- each operator shard runs as a **local task** on that runtime (cannot migrate cores)

You’re not building scheduling; the executor does it. You’re building:

- routing/partitioning
- graph lifecycle
- backpressure/buffering policy
- progress/watermark propagation (LSN frontiers)

### Why Rust fits your constraints

- no GC → tighter tail latency
- message passing can be structured so clones are cheap:
  - payload = `Bytes`/`Arc`/arena handle
  - message = small header + handle

- stateful shards own their memory; GC is your explicit policy (frontier-driven), not runtime-driven.

### What you still must build (Rust or Go)

- the graph manager:
  - structural hashing, refcounting, query attach/detach
  - online reconfiguration (update routing/subscriptions safely)

- sharding rules for stateful operators
- a separate I/O lane for blocking/slow tasks (PG direct queries for up-queries)

---

## 8) Timely: what it gives “out of the box” and what you’d fight

You considered Timely seriously and we mapped it to your needs.

### Timely would solve

- the **multi-core runtime** (workers, scheduling loop)
- cross-worker **message routing/exchange**
- **progress tracking** (capabilities/frontiers) that is the generalized form of your `Frontier(LSN)`
- cycles/feedback are normal

In other words: Timely is largely “the runtime you don’t want to write”.

### Timely does not solve (you still build)

- SQL planner/compiler
- query lifecycle and coordinated install/uninstall (the control plane)
- the “shared index reuse” story unless you adopt Differential or reimplement something similar
- I/O boundaries (don’t block operators)

### Where you might fight it

- the progress model is baked into how you reason about correctness
- dynamic graph mutation is possible, but pushes you toward coordinated changes across workers
- you’ll work with Timely’s buffering/ownership model rather than fully controlling it end-to-end

---

## 9) “Runtimes that run a cross-core graph but don’t bake in time/frontiers”

We looked for Rust libraries that feel like:

- “processing graph runtime”
- cross-core
- but not “frontier-first” like Timely

The closest categories are:

1. **Flowgraph runtimes** (often from other domains like SDR) that provide a scheduler/executor and let you define your own semantics on messages.
2. **Actor frameworks** where you wire a graph yourself and own semantics.

The practical takeaway we landed on:

- If you want **runtime + graph** without Timely’s progress model, you’ll likely adapt something domain-specific (graph scheduler) or build a thin graph layer on an actor runtime.
- But regardless, _your engine_ will still need a progress concept (even if the runtime doesn’t force one), because joins + GC require it.

---

## 10) Timely and message structure: can you add message types?

Timely does **not** force a particular payload schema. What it does enforce:

- each stream carries a single Rust type (static)
- Timely adds its own timestamp/envelope metadata for progress tracking

To add message “kinds”, you can:

- use an `enum` payload type on a stream, **or**
- use multiple streams (data vs control/up-query), often cleaner.

The bigger constraint is not “message structure”, it’s that messages are always associated with some timestamp/progress mechanism in Timely’s world.

---

## 11) Where this leaves you: the “simple but correct” middle path

You’re leaning away from Timely because you want flexibility and don’t want to inherit its conceptual model, but you also don’t want to write a scheduler.

The most coherent path we converged on is:

### Rust + per-core single-thread runtimes + explicit LSN frontiers

- Use an executor to avoid writing scheduling.
- Keep your semantics “domain-simple”:
  - LSN watermark propagation
  - explicit up-query resolution and GC floors

- Shard stateful ops by key; replicate/fuse stateless ops.
- Graph manager handles query attach/detach and structural sharing of indexes/joins.

This keeps:

- your mental model close to “actors”
- correctness and GC controlled by your LSN frontier rules
- performance predictable (no GC, no huge copies)

---

## 12) Decision checklist (what matters next)

To nail down the architecture, the most decisive questions are:

1. **Row-level vs batch-level transport**
   - Will you pass per-row updates or Arrow-ish batches/blocks between operators?
   - This dominates overhead more than language choice.

2. **Join/state reuse strategy**
   - Do you want one shared join index reused by many queries?
   - If yes, you are building “arrangement-lite” no matter what runtime you choose.

3. **Up-query fulfillment**
   - Are up-queries _always_ satisfied from retained history?
   - Or can they trigger “pull from Postgres” (blocking I/O boundary)?
   - This affects your control plane and how much history you must retain.

4. **Expected scale**
   - peak updates/sec
   - number of concurrent queries
   - number of joins / group-bys
     These decide batching, sharding granularity, and whether operator fusion is mandatory.

---

If you want, I can turn this into a concrete “first implementation plan”:

- message types + invariants
- physicalization algorithm (logical → per-core shards + exchanges)
- join operator state layout + GC rules
- query add/remove protocol (online reconfiguration)
- minimal debugging/metrics you’ll want from day 1 (frontier lag, per-edge queue depth, per-operator memory floor, etc.)

=======

Here’s a transcription of the diagram (including the text) from thr TLDraw image in this directory with ASCII diagrams.

---

## Note (top-left)

We don't use multiplicity directly on
the messages like in traditional
differential dataflow or DBSP. That
way we can track partial updates and
emit them.

---

## Message types

### Downwards Message Types

```
+--------------------------------------------------------------------+
| Row (data, oldData, operation=insert/update/delete/fetch, LSN)      |
+--------------------------------------------------------------------+

+-------------------------------+
| Up-query Complete (ID, LSN)   |
+-------------------------------+

+----------------+
| Frontier (LSN) |
+----------------+
```

### Upwards Message Types

```
+---------------------------------------+
| Up-query (ID, table, predicate, LSN)  |
+---------------------------------------+
```

---

## Operators

Title text:

Operators
All queries are compiled to a set of operators

```
+------------------+     +------------------+
| Map              |     | Filter           |
| (stateless)      |     | (stateless)      |
+------------------+     +------------------+

+-----------------------------+
| Inner Join                  |
| (windowed state)            |
+-----------------------------+

Only maintains an index + history
back to min asked at LSN when
doing an up-query
```

---

## Inputs notes (left of graph)

```
Inputs manage all input date for a table.
• The replication stream is passed
  through.
• If they receive a message for rows
  that match predicate from a downstream
  operator they go back to postgres and
  ask for that data as a direct query.
• Inputs track "sent rows" by id, this
  is required to compute if an up-query
  result is an insert or a update
• After each replicated transaction a
  Frontier is sent with the LSN
• After an up query result is returned,
  an up-query frontier with the id of
  the request + computed LSN is sent
```

---

## Main diagram

### Postgres (top)

```
+----------------------------------------------+
|                  Postgres                     |
|                                              |
|   +--------------+      +--------------+     |
|   | Direct Query |      | Replication  |     |
|   +--------------+      +--------------+     |
+----------------------------------------------+
```

(Direct Query is drawn with dashed arrows to inputs; Replication with solid arrows.)

### Dataflow Graph

```
+----------------------------------------------------------------------------------+
|                                Dataflow Graph                                    |
|                                                                                  |
|   +-------------------+        +-------------------+        +-------------------+ |
|   | Input: Projects   |        | Input: Issues     |        | Input: Comments   | |
|   +-------------------+        +-------------------+        +-------------------+ |
|           |                            |                                            |
|           v                            v                                            |
|   +-------------------+                |                                            |
|   | Filter: active =  |                |                                            |
|   | true              |                |                                            |
|   +-------------------+                |                                            |
|           \____________________________/                                            |
|                        \                                                           |
|                         v                                                          |
|                    +-----------+                                                   |
|                    | Inner Join |                                                  |
|                    +-----------+                                                   |
|                         |                                                          |
|                         v                                                          |
|      +-----------------------------------------------+                             |
|      | Shape: issue WHERE                            |                             |
|      | project.active = true                         |                             |
|      +-----------------------------------------------+                             |
|                                                                                  |
|  Up-query annotations shown on arrows:                                           |
|    - “Up-query with the active = true added” (from Filter back up to Input)      |
|    - “Can do an "up-query" to ask for projectId in [...]” (from Join to Filter)  |
|                                                                                  |
|  Note inside graph:                                                              |
|    When an operator like a join does an                                          |
|    up-query it starts accumulating state                                         |
|    over a window untill it receives the                                          |
|    up-query complete that matches its                                            |
|    quires. It can then GC state + emit                                           |
|    its own "concreate" frontier                                                  |
+----------------------------------------------------------------------------------+
```

---

## Bottom notes

```
All "shapes" / queries form a single graph.
When a new shape is added, it's copied into a
proposed series of operators, if any exist already
they are reused.
An output can, on being added, ask for a full
snapshot as an up-query

Nodes in the graph (including inputs) can be
invalidated (such as when a table schema changes),
this cascades to all downstream nodes. This is
"invalidates" a shape.
Nodes are GC'd when they have no downstream nodes
```

If you want, I can also produce a “cleaned” version of the ASCII (same content, fewer typos, and with a clearer separation between replication vs direct-query arrows).
