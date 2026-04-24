---
title: 'Galvanic V1: Sync-Query Engine'
version: '1.0'
status: draft
owner: samwillis
contributors: []
created: 2026-03-04
last_updated: 2026-03-05
prd: N/A
prd_version: N/A
---

# Galvanic V1: Sync-Query Engine

## 1. Introduction

### 1.1 Summary

The current Elixir-based Electric sync service hits expressiveness, performance, and scale limits that block the next stage of product development. Galvanic is a new sync-query engine written in Rust that replaces it with a shared dataflow graph capable of processing joins, subqueries, and sparse fanout to 100k+ concurrent live shapes. It uses Timely Dataflow for multi-core scheduling, an up-query mechanism (inspired by Noria) for on-demand partial-state filling, and multiset diff semantics (from Differential Dataflow/DBSP) for algebraically correct incremental maintenance. The engine is database-agnostic, with Postgres as the V1 adapter, and writes its output to a separate Durable Streams service for persistence and client delivery.

### 1.2 Background

### 1.2.1 Current system

ElectricSQL's sync service watches a Postgres database for changes and fans them out to connected clients, each subscribing to a "shape" — a query-like definition describing its slice of data. The current Elixir implementation works well for single-table shapes with simple filters.

### 1.2.2 Current limitations

The current architecture has specific constraints that a replacement must address:

- Complex queries involving joins and subqueries are bolted on rather than native to the processing model.
- Elixir does not provide the low-level memory and scheduling control needed for the next scale tier.
- Per-shape consumer/materializer process patterns are effective at current scale but do not match million-shape targets.
- Replication fragments are routed synchronously to all affected shape consumers; one slow consumer stalls global ingest (head-of-line blocking).
- The engine owns its own storage; persistent storage is moving to a separate Durable Streams service.
- The engine is coupled to Postgres internals; future adapters for MySQL, MongoDB, and others need a clean plug-in boundary.

### 1.2.3 Research foundations

The design draws on three bodies of work:

- **Noria** (MIT, Gjengset thesis) — partial state in dataflow-based materialized views, up-queries for on-demand state filling, correctness invariants for races between live deltas and up-query responses.
- **Differential Dataflow / Timely Dataflow** (McSherry et al.) — multiset collections with +1/-1 diffs, partially ordered versions, frontier-based progress tracking, capability model for scheduling.
- **DBSP** (Budiu, McSherry, Ryzhyk, Tannen) — formal theory of incremental view maintenance using stream integration/differentiation over abelian groups (Z-sets). Provides the algebraic foundation: linear operators are their own incremental version, bilinear operators (joins) incrementalize via the product rule, and the chain rule composes incremental sub-queries.

These are detailed further in Section 3 within the proposal.

### 1.3 Problem

The sync engine is the core of ElectricSQL's value proposition — it turns a Postgres database into a real-time data source for client applications. The current implementation cannot scale to the expressiveness (joins, subqueries), concurrency (100k+ shapes), and operational control (memory management, scheduling, pluggable storage) required for the next product phase.

Specific architectural constraints that must be resolved in V1 (not deferred) are documented in Section 18 of the proposal, including: non-blocking fanout dispatch, compiler-enforced query capability boundaries, formalized snapshot/live interleaving, scoped failure handling, HTTP/proxy cache compatibility, and shared-graph (not process-per-shape) execution.

### 1.4 Goals & Non-Goals

### 1.4.1 Goals

- Sparse fanout to very large live shape counts (100k+) without global stalls.
- Native support for joins and subqueries via a shared dataflow graph with operator reuse.
- No additional internal latency beyond explicit database round-trips (query-back).
- Database-agnostic engine core with all database-specific logic in pluggable adapters. Postgres adapter first.
- Dynamic addition and removal of shapes without server restart.
- Preserve the reverse-index-driven sparse fanout performance property from the current system.

### 1.4.2 Non-Goals

- Full aggregate support (`COUNT`, `SUM`, `AVG`) — deferred to V3.
- Left/right outer join operators — deferred to V2. Shapes requiring outer join semantics are rejected at compile time.
- Full boolean-factoring/routing optimizer — deferred to V2/V3.
- Cost-based join ordering — deferred to V2/V3. V1 uses join order as specified.
- Live migration of processing branches between generic and dedicated paths.
- Crash-resume continuation on same streams — deferred to V2. V1 crash recovery is full rebuild + new stream IDs.
- In-place schema migration across DDL changes — deferred to V2/V3. V1 invalidates and rebuilds affected shapes.

### 1.5 Proposal

The detailed technical design is organized into the following sections. Section numbering is preserved for stable cross-references throughout the document.

| Section | Topic                                                                                               |
| ------- | --------------------------------------------------------------------------------------------------- |
| 2       | Architecture overview (layers, runtime, Timely integration, two-layer frontier model)               |
| 3       | External research and implications (Noria, Differential Dataflow)                                   |
| 4       | Protocol and message model (Row, UpQuery, Frontier, dedupe)                                         |
| 5       | Version model and progress (frontiers, stability semantics)                                         |
| 6       | IR and compiler design (three-phase pipeline, optimizer passes)                                     |
| 7       | Operator model (operator set, contracts, fanout, shared graph, reuse)                               |
| 8       | Up-query model (backward routing, augmentation, join modes, response assembly)                      |
| 9       | Ingest and database adapters (source controllers, query-back, LSN resolution)                       |
| 10      | Sink path and Durable Streams (output pipeline, exactly-once, interface contract)                   |
| 11      | Control-plane behavior (shape lifecycle, DDL handling)                                              |
| 12      | Runtime, sharding, and scheduling (dual-channel model, frontier layers, state durability, eviction) |
| 13      | Correctness and performance invariants                                                              |
| 14      | Release scope (V1, V2, V3)                                                                          |
| 15      | Delivery plan (phased implementation)                                                               |
| 16      | Proposed Rust stack                                                                                 |
| 17      | Risks and mitigations                                                                               |
| 18      | Gap closure from current Electric architecture                                                      |

---

## 2. Architecture overview

### 2.1 The five layers

Galvanic is structured as five composable layers:

1. **Ingest** — Connects to the upstream database and captures changes. For Postgres, this means reading the Write-Ahead Log (WAL) via logical replication. This layer also handles **query-back**: issuing SQL queries to fetch historical data that the change stream doesn't provide.

2. **Compiler** — Takes a shape or query definition and compiles it through a series of intermediate representations (IRs) into a physical execution plan — a recipe the engine can run.

3. **Engine** — Executes a shared dataflow graph of operators (filter, join, fanout, etc.) that processes incoming changes and routes results to the right subscribers. Uses **up-queries** (explained in Section 8) to request missing data on demand.

4. **Durable Streams** — A separate persistence and delivery service. The engine writes its output here; the proxy reads from here to serve clients. This replaces the in-engine storage of the current system.

5. **Proxy** — The HTTP-facing service that clients talk to. Handles the shape protocol (subscribe, poll, handle rotation), caching semantics, and stream resolution against Durable Streams.

### 2.2 Architecture diagram

```text
                         (shape requests / live reads)
+-----------+      HTTP      +-------------------+      read/write      +----------------------+
| Browser / | <------------> |  Galvanic Proxy   | <------------------> |   Durable Streams    |
| SDK Client|                | (protocol/cache)  |                      | (append + tail/read) |
+-----------+                +---------+---------+                      +-----------+----------+
                                       |                                            ^
                                       | cache miss / shape attach                  |
                                       v                                            |
                 +---------------------+--------------------------------------------+---+
                 |             Galvanic Server (Rust: Tokio + Timely)                    |
                 |                                                                      |
                 |   +-----------+      +------------+      +------------------------+  |
CDC + query-back |   |  ingest   | ---> |  compiler  | ---> |  engine (shared graph) |--+
adapters         |   | (adapter) |      | (IR/plan)  |      | map/filter/join/fanout |
                 |   +-----+-----+      +-----+------+      +-----------+------------+  |
                 +---------|-------------------|--------------------------|---------------+
                           |                   |                          |
                           v                   |                          |
                   +---------------+           |                          |
                   | Postgres WAL  | <---------+------ up-query SQL ------+
                   | / other CDC   |
                   +---------------+
```

### 2.3 Logical deployment

The five layers map to deployable units:

- `galvanic-ingest` — library
- `galvanic-compiler` — library
- `galvanic-engine` — library
- `durable-streams-server` — standalone service
- `galvanic-proxy` — standalone service

The first three libraries compose into a single runtime server, scoped to one tenant (upstream database). The Durable Streams server and Proxy run as separate services.

### 2.4 Runtime and language decisions

- **Implementation language:** Rust.
- **Async/service runtime:** Tokio — handles network I/O, database connections, proxy HTTP serving, and control-plane tasks.
- **Dataflow execution:** Timely Dataflow — a Rust framework for building dataflow computations with strong progress-tracking guarantees (see Section 2.5). Galvanic builds its own operators on top of Timely's scheduling and communication primitives.
- **Storage:** Owned by Durable Streams, not the engine.

### 2.5 Why Timely (and not Differential Dataflow)?

Two related Rust frameworks were evaluated:

- **Timely Dataflow** provides a strong progress/frontier model, robust multi-core execution, and scheduling/communication primitives for dataflow graphs. It gives us the low-level control we need.

- **Differential Dataflow** (built on Timely) provides powerful high-level incremental operators over maintained data structures called "arrangements." It excels when you need heavy, shared, maintained state.

Galvanic's core mechanic is the **up-query**: when an operator is missing data, it explicitly requests it from upstream (see Section 8). This "missing state + request it on demand" pattern does not fit naturally into Differential's standard stateful operators.

**Decision:** Use Timely as the execution substrate. Build custom up-query-aware operators on top. Borrow Differential-inspired patterns (consolidation, arrangement-like indexing, semi-join structure) where useful, but do not couple V1 correctness to Differential's operator internals.

### 2.6 How Timely supports up-queries

Timely provides three mechanisms that directly support the up-query pattern:

1. **Capabilities.** An operator that holds a capability for time `t` is telling Timely "I might still emit data at time `t`." The output frontier cannot advance past `t` while the capability is held. When an operator issues an up-query, it **retains its capability** for the relevant time rather than dropping it. This prevents the frontier from advancing past the pending work — which is the exact behavior the up-query model requires. When the up-query completes and response rows are processed, the operator drops the capability and the frontier advances automatically.

2. **Activators.** Timely allows external code to **activate** an operator, causing it to be scheduled for execution even if no new forward data has arrived on its Timely input edges. This is used to wake operators when up-query messages arrive on their backward channel (see below). Without activators, an operator with no forward input would never be scheduled to process backward requests.

3. **Forward data edges.** Up-query _responses_ flow forward through the graph as normal Timely data — rows tagged with `upquery_ids`. Operators process response rows through the same logic as live rows (filters filter them, joins look them up). This reuses Timely's data transport, buffering, and exchange/partitioning for the response path.

The up-query _request_ path is not modeled as Timely data edges (since Timely edges are forward-only). Instead, each operator maintains a **backward up-query channel** (Tokio mpsc) alongside its Timely inputs. The operator's `run()` method drains both the Timely input handles (forward data) and the backward channel (up-query requests). Each operator augments the up-query predicate and forwards it to its parent's backward channel, activating the parent via Timely's activator so it gets scheduled. This backward traversal is detailed in Section 8.3.

This design uses Timely for what it does well — multi-core scheduling, forward data transport, capability-based progress tracking — and adds a thin backward control-plane layer alongside it for up-query routing.

### 2.7 Two-layer frontier model

Because Timely computes one physical frontier per output port, and operators may be shared across many shapes with independent up-query states, Galvanic maintains a **two-layer frontier model**:

**Layer 1 — Timely physical frontier.** The conservative lower bound across all scopes. Timely computes this automatically from held capabilities and in-flight messages. If any scope has a pending up-query at time `t`, the physical frontier stays at or below `t`. This governs coarse-grained progress (graph quiescence, capability accounting).

**Layer 2 — Galvanic per-scope logical frontier.** Fine-grained stability signals, one per output/sink scope. Each scope's logical frontier advances when:

- The upstream source(s) frontier allows it (all source controllers feeding this scope's dataflow path have frontier >= the candidate version), AND
- All pending up-queries for that specific scope at operators on this path at versions ≤ the candidate frontier are complete.

The sink uses per-scope logical frontiers for stability decisions (when to mark data as stable, when to emit frontier signals to Durable Streams). This prevents one slow shape's up-query from blocking stability advancement for unrelated shapes.

```text
Example:
  Timely physical frontier (output port):  t=101  (held by shape B's pending up-query)

  Galvanic logical frontiers:
    Shape A (no pending up-queries):       t=105  → can emit stable data through t=105
    Shape B (pending up-query at t=101):   t=100  → waiting
    Shape C (no pending up-queries):       t=105  → can emit stable data through t=105
```

Data flows immediately regardless of either frontier layer. Frontiers only signal stability. The per-scope logical layer ensures that shared operators do not create false dependencies between independent shapes.

---

## 3. External research and implications

### 3.1 Noria thesis

[Noria](https://pdos.csail.mit.edu/papers/jfrg:thesis.pdf) is an academic database system whose thesis on partial state and up-queries directly informs Galvanic's design:

- **Up-queries** are explicit mechanisms to fill missing state on demand in a dataflow system. Rather than pre-loading all data, an operator can request just the data it needs.
- Correctness under partial state requires explicit invariants for races between live deltas and up-query responses.
- Up-query explosion under sharding mismatch is a real risk (quadratic amplification) and needs explicit controls.
- Recovery by re-introducing operators and replaying data is a viable baseline strategy.

Applied to Galvanic:

- Up-queries are kept explicit in the protocol and operator contracts.
- We avoid unconstrained fanout/shard expansion via the attach/explode separation and branch caps (see Section 7).
- Recovery and graph rebuild are treated as first-class operations, not edge cases.

### 3.2 Noria codebase findings

From inspecting the [Noria codebase](https://github.com/mit-pdos/noria):

- SQL compilation follows: parser → query graph → MIR → flow graph.
- Execution uses single-threaded domain tasks on Tokio worker pools.
- Up-query/replay is an explicit packet path with dedicated handling.
- Partial replay has explicit deadlock risk if replay concurrency is below replay fan-in width.
- Replay batching with a timeout exists to coalesce key requests before issuing replays.
- Union/shard-merger operators buffer replay pieces until all required parents arrive.

Implications for Galvanic:

- We need a hard invariant: `max_inflight_upqueries_per_scope >= max_upquery_fan_in`.
- We need explicit source/routing scope on up-queries to avoid all-shards amplification.
- We should deduplicate in-flight up-queries by `(operator, predicate/key, request_class, version_bucket)` with a formal bucket policy tied to visibility/frontier semantics (defined in Section 4.5).
- We should keep bounded replay key batching (configurable `input_dedupe_window_ms`, default 5ms).
- We should keep `fanOutAttach`/`fanOutExplode` split to avoid premature explosion.

---

## 4. Protocol and message model

This section describes the messages that flow between operators inside the engine. These are internal protocol messages, not the HTTP wire protocol seen by clients.

### 4.1 Downstream messages (data flowing toward clients)

**`Row`** — carries a single multiset diff:

- `data` — the row payload
- `diff` — `+1` (insertion) or `-1` (retraction). The graph uses **multiset semantics**: an insert is a `+1`, a delete is a `-1`, and an update is decomposed into a `-1` of the old row followed by a `+1` of the new row. This is the same model used by differential dataflow, DBSP, and TanStack DB's IVM, and naturally extends to aggregates and other algebraic operators in the future.
- `version` — the source version at which this change occurred (e.g. a Postgres LSN)
- `upquery_ids` — (present on snapshot/fetch rows only) the set of up-query IDs that this row satisfies. Fetch rows are always `diff=+1` (inserting the fetched state). Because in-flight up-queries are deduplicated by `(operator, predicate/key, request_class, version_bucket)`, a single fetch response may satisfy multiple waiting up-queries simultaneously.
- `meta` — additional metadata

**`UpQueryComplete`** — signals that an up-query has finished (all fetch rows for this request have been delivered):

- `upquery_ids` — the set of up-query IDs that this completion satisfies. Multiple IDs appear when deduplicated up-queries were coalesced into a single query-back.
- `version` — the version at which the response is valid

**`Frontier`** — a progress marker indicating that no future messages will arrive with a version less than or equal to the specified value:

- `frontier_version` — a completed lower-bound marker; versions `<= frontier_version` are closed for that scope

### 4.2 Upstream messages (requests flowing toward the data source)

**`UpQuery`** — a request for missing data, routed backward through the graph:

- `upquery_id` — unique identifier for this request
- `source` — which upstream source to query
- `predicate` — a structured predicate describing what data is needed. This is **not** a SQL string; it is a composable expression tree that each operator augments as the up-query passes through it (see Section 8.3). The source controller compiles the final accumulated predicate into a database query.
- `requested_version` — the version context for the request
- `routing_scope` — limits propagation to the branch that requested it (prevents amplification)

Routing rule: up-queries propagate backward through the graph via per-operator backward channels (Tokio mpsc, see Section 8.3.0). Each operator on the path augments the predicate before forwarding it upstream. Up-queries only propagate up the branches that requested them — they are never broadcast to unrelated parts of the graph. Parent operators are activated via Timely activators when a backward message is posted (Section 2.6).

### 4.3 Provisional and stable state

There is no explicit "provisional row" marker in V1. Instead:

- Snapshot rows and live rows both flow immediately as they arrive.
- **Stability** — the guarantee that all data up to a certain version has been delivered — is indicated solely by frontier progression.
- "No frontier emitted yet" means "the data seen so far is still provisional."

This design intentionally avoids additional buffering and coordination complexity. Downstream consumers (the sink and proxy) understand that data without a covering frontier is provisional.

### 4.4 Message flow diagram

```text
Downstream data/control (Timely forward edges)
-----------------------------------------------
ingest --> operators --> sink --> durable streams --> proxy --> client
           |              |
           |              +--> Frontier(version)
           +--> Row(data, diff=+1|-1, version)
           +--> UpQueryComplete(ids, version)

Upstream request/control (Tokio mpsc backward channels)
-------------------------------------------------------
operator needing state
    --[backward inbox]--> parent operator (augments predicate)
    --[backward inbox]--> ... (hop-by-hop augmentation)
    --[backward inbox]--> source controller
    --> compiles predicate to SQL, issues query-back via Tokio

Response (re-enters Timely forward edges at source controller)
--------------------------------------------------------------
source controller
    --> fetch rows (Row diff=+1, upquery_ids, version) via Timely forward edges
    --> operators process response rows through normal logic
    --> UpQueryComplete
```

### 4.5 Up-query dedupe key and `version_bucket` semantics

Up-query dedupe uses this key:

`(operator_id, normalized_predicate_or_keyset, request_class, version_bucket)`

Where:

- `operator_id` scopes dedupe to the requesting operator instance (or shared operator scope key).
- `normalized_predicate_or_keyset` is the canonicalized predicate tree (or canonical key-list representation).
- `request_class` is `snapshot` or `point_miss` (or another explicit class in future).
- `version_bucket` prevents unsafe coalescing across different visibility contexts.

V1 bucket rules (scalar versions):

- `snapshot` requests bucket by **frontier interval** at the source controller:
  - all requests while source frontier is in `(F_prev, F_curr]` share bucket `snapshot@F_curr`.
  - once frontier advances, a new bucket opens.
- `point_miss` requests bucket by exact `requested_version` (no widening).

Safety rule:

- Requests with different `request_class` or different `version_bucket` **must not** coalesce.
- If an adapter cannot prove the bucketing rule for a request class, dedupe falls back to exact `(operator, predicate/key, requested_version)`.

---

## 5. Version model and progress

### 5.1 What versions represent

Every change that enters the system carries a **version** — a comparable value that reflects the order in which changes occurred at the source database. For Postgres, this is the Log Sequence Number (LSN) from the WAL.

A **frontier** is a lower bound: once the engine emits `Frontier(v=103)`, it promises that no future data will arrive with a version ≤ 103. This is how downstream consumers know that data is stable and complete up to that point.

### 5.2 Core model (V1)

- V1 uses a single scalar version (the Postgres LSN) for single-source pipelines.
- Frontiers are propagated as lower bounds on future versions.
- Frontier publication is per-output/per-sink, not a single global gate for all shapes.

### 5.3 Multi-dimensional compatibility

The internal version API is designed to support partially ordered (antichain) versions, so future recursive or iterative operators can use multi-dimensional versioning without rewriting the engine. V1 runs single-dimension fast-paths while preserving this interface boundary.

### 5.4 Frontier and stability semantics

Galvanic uses a **two-layer frontier model** (detailed in Section 2.7) that separates Timely's physical progress tracking from Galvanic's per-scope stability signals:

- **Physical frontier (Timely).** An operator with pending up-queries retains Timely capabilities for the relevant time. Timely's automatic progress tracking ensures the physical frontier does not advance past pending work. This is a conservative lower bound across all scopes sharing an output port.

- **Per-scope logical frontier (Galvanic).** Each output/sink scope tracks its own frontier independently. A scope's logical frontier advances when both conditions are met: (1) upstream progress allows it, and (2) all pending up-queries for that scope at versions ≤ the candidate frontier are complete. The sink uses per-scope logical frontiers for stability decisions.

```text
Version axis (scalar V1):   v100 ---- v101 ---- v102 ---- v103 ---->

Downstream rows:
  live row A@v101 --------------------------------> emit immediately
  snapshot row S@v102 (from UpQuery U1) ----------> emit immediately

Control:
  UpQuery(U1, requested=v101) --------------------> adapter/query-back
  UpQueryComplete(U1, at=v102) -------------------> operator clears wait

Operator state:
  Timely capability held for t=101 (physical frontier gated)
  pending_upqueries[scope=S1] = {U1}  --(complete)--> {}
  capability dropped → physical frontier advances

Per-scope logical frontier rule:
  emit Frontier(scope=S, vX) only when:
  1) upstream source(s) frontier allows vX (i.e., all source controllers
     feeding this path have frontier >= vX), AND
  2) all pending up-queries for scope S at operators on this path
     at versions ≤ vX are complete

Consequence:
  rows can flow before stability; "no frontier yet" is the provisional signal.
  pending work in one scope must not block frontier advancement in other scopes.
  physical frontier may lag behind logical frontiers for unaffected scopes — this is correct.
```

---

## 6. IR and compiler design

### 6.1 Why an intermediate representation (IR)?

To keep the engine database-agnostic, user-facing query definitions (shapes, SQL, DSL) are not consumed directly by the engine. Instead, they are compiled through a series of **intermediate representations**:

- Query definitions are normalized into a canonical IR.
- Database-specific behavior lives in adapters and custom IR/operator extensions.
- Physical planning (how to actually execute the query) is a separate concern from logical semantics (what the query means).

This separation means the engine core never needs to know about Postgres-specific SQL syntax, MySQL's replication format, or any other database detail.

### 6.2 IR phases

#### Phase A: Canonical logical IR (SQL-like)

Shape-level constructs expressed in a database-neutral form:

- `from`, `join`, `where`, `select`, `order/limit` (where applicable), subqueries

This resembles TanStack DB's query IR structure and keeps user-level semantics explicit.

#### Phase B: Normalized operator IR (algebraic)

Lowers the logical IR into the engine's operator vocabulary:

- `map`, `filter`, `project`, `join`, `semiJoin`, `fanOut`, `consolidate`, `output`

Each operator edge is annotated with:

- Required columns (which fields this operator actually reads)
- Recipient dependency (`none` | `attached` | `exploded`) — whether the operator needs to know which subscribers are affected
- Pushdown eligibility — whether predicates can be pushed earlier in the graph
- Residual predicates — filters that couldn't be pushed down

#### Phase C: Physical graph IR

Adds execution-level detail:

- Sharding/exchange placement (how to split work across cores)
- `fanOutAttach` / `fanOutExplode` split (see Section 7)
- Optional `demuxByPlan` branch assignment
- Branch caps and generic overflow branch routing

### 6.3 IR lowering pipeline

```text
ShapeDef / SQL / DSL
        |
        v
[Frontend Parser + Binder]
        |
        v
Canonical Logical IR (Phase A)
  - from/join/where/select/subquery
        |
        v
[Logical Rewrites]
  - normalize aliases/expressions
  - IN(subquery) -> semiJoin
        |
        v
Operator IR (Phase B)
  - map/filter/project/join/semiJoin/fanOut/consolidate/output
  - recipient-dependency + column-demand annotations
        |
        v
[Physical Planner]
  - fanOutAttach/fanOutExplode placement
  - optional demuxByPlan
  - shard/exchange assignment
        |
        v
Physical Graph IR (Phase C)
        |
        v
Graph Materialization + Refcounted Reuse
```

### 6.4 Optimizer passes (V1)

The compiler applies a series of optimization passes:

1. **Normalize** expressions and aliases.
2. **Lower `IN (subquery)`** to semi-join form — a semi-join returns rows from the left side where a matching row exists on the right side, without duplicating left rows.
3. **Split root `AND` predicates** — the baseline correctness path that separates conjunctive filters so each can be pushed independently.
4. **Safe guard extraction** — identifies parts of a predicate that depend only on the row (not on the recipient) and can be evaluated before fanout, pruning irrelevant rows early: `P(row, recipient) => G(row)`.
5. **Conservative `OR` handling** — mixed `OR` predicates remain post-fanout in V1 (full boolean factoring is a V2/V3 item).
6. **Column-demand pruning** — removes unused columns from edges between operators.
7. **Fanout placement** — places `attach` early enough for the reverse index to work, and `explode` as late as possible (see Section 7).
8. **Physical branch planning** with caps.

**Deferred to V2/V3:** Join ordering optimization. For multi-way joins composed from binary join operators, the order of joins affects up-query fan-out and state size. V1 uses the join order as specified in the shape definition (or as lowered from the SQL). V2 should introduce cost-based join ordering that considers: (a) estimated cardinality of each side, (b) up-query fan-out under key-list vs. subquery mode, and (c) expected state size for each join side's index. This is listed in V3 candidates (Section 14.3).

### 6.5 Guard extraction policy

- **V1 correctness baseline:** `AND`-split pushdown.
- **V1 optimization:** safe guard extraction for broader pre-fanout pruning.
- **V2:** full boolean factoring/routing.

### 6.6 Parser frontends

The engine consumes canonical logical IR only — it does not depend on any SQL parser. Parsing is the job of frontend modules:

- **Postgres-compatible frontend:** Uses the PostgreSQL parser (`pg_query`) for exact PG shape/filter compatibility. This is the V1 default to match current Electric behavior.
- **Portable SQL frontend:** Uses `sqlparser` for ANSI-ish multi-dialect support where exact PG behavior is not required. Planned for V2.
- **Non-SQL frontend:** A typed shape DSL or JSON that compiles directly to canonical IR.

In all cases, the frontend normalizes immediately into canonical IR so the downstream compiler and engine remain database-agnostic.

### 6.7 Adapter capability gating

To keep the core engine portable without hidden Postgres coupling:

- Every adapter exposes a **`CapabilitySet`** — a declaration of what it supports (scalar version order, before/after image quality, predicate pushdown classes, snapshot semantics, etc.).
- The compiler validates IR against the `CapabilitySet` before physical planning.
- Unsupported constructs fail at compile time with explicit error codes — no silent runtime fallback.
- Database-specific functionality is introduced via declared IR extensions/custom operators, each bound to named capabilities.

This enforces "portable-by-default, explicit-escape-hatch" behavior for MySQL, MongoDB, and future adapters.

---

## 7. Operator model

### 7.1 What is an operator?

An **operator** is a node in the dataflow graph that processes rows. Each operator receives input rows, transforms them in some way, and emits output rows. Operators can be:

- **Stateless** — process each row independently (e.g. filtering or transforming fields).
- **Stateful** — maintain internal state across rows (e.g. join indexes).

### 7.2 Operator set (V1)

| Category          | Operators                       | Description                                                                       |
| ----------------- | ------------------------------- | --------------------------------------------------------------------------------- |
| Stateless         | `map`, `filter`, `project`      | Transform rows, select rows matching a predicate, select columns                  |
| Stateful          | `join`, `semiJoin`              | Combine rows from two sources; semi-join checks for existence without duplicating |
| Fanout            | `fanOutAttach`, `fanOutExplode` | Route rows to the right subscribers (see Section 7.5)                             |
| Physical exchange | `demuxByPlan` (optional)        | Split processing into bounded branches for backpressure isolation                 |
| Output            | `consolidate`, `sinkWrite`      | Merge/deduplicate results and write to Durable Streams                            |

No aggregate operators (`COUNT`, `SUM`, etc.) in V1.

### 7.2.1 Operator definitions (V1 contracts)

This section defines the runtime contract for each V1 operator: what it consumes, what state it keeps, and what it emits.

#### `map`

- **Role:** deterministic row transform.
- **Input:** `Row(data, diff, version, meta)`.
- **State:** none (stateless).
- **Output:** exactly one row per input row, same `diff` and `version`, transformed `data`.
- **Notes:** if a mapping rewrites columns referenced by upstream predicates, reverse-mapping rules apply for up-query augmentation (Section 8.3.1).

#### `filter`

- **Role:** predicate gate.
- **Input:** `Row(...)`.
- **State:** none.
- **Output:** input row unchanged when predicate is true; no output when false.
- **Notes:** filter predicates are also added to backward up-query predicates (`AND` augmentation).

#### `project`

- **Role:** column/shape projection.
- **Input:** `Row(...)`.
- **State:** none.
- **Output:** row with projected columns, same `diff` and `version`.
- **Notes:** in V1 full-row mode this is primarily a logical boundary; final client projection happens at sink.

#### `join` (inner join in V1; left/right join V2 candidate)

- **Role:** combine matching rows from two inputs on join key(s).
- **Input:** left/right row streams (multiset diffs).
- **State:** key-indexed lookup state for both sides; scoped pending up-query tracking.
- **Output:** joined rows with propagated multiset diffs and source version ordering.
- **V1 scope:** inner join only. Left/right outer joins are a V2 candidate. Shapes requiring outer join semantics are rejected at compile time in V1.
- **NULL key handling:** NULL join keys never match, consistent with SQL semantics. Rows with NULL join key values pass through input-side processing but produce no joined output.
- **Notes:** on key miss, may issue up-query to either side; processes fetch rows through same logic as live rows.

#### `semiJoin`

- **Role:** existence filter (`left WHERE EXISTS right-match`).
- **Input:** left/right row streams.
- **State:** right-side existence index (and minimal left-side tracking required for retract/update correctness).
- **Output:** rows from the left side only; no right payload duplication.
- **Notes:** canonical lowering target for `WHERE x IN (subquery)`.

#### `fanOutAttach`

- **Role:** compute recipient set without row duplication.
- **Input:** shared row stream.
- **State:** reverse index from guard/key values to recipient IDs.
- **Output:** same row payload + attached recipient set.
- **Notes:** hot-path sparse fanout primitive; must avoid blocking on per-recipient slow paths.

#### `demuxByPlan` (optional)

- **Role:** physical branch split for bounded isolation/backpressure control.
- **Input:** recipient-attached rows.
- **State:** branch assignment metadata; bounded queues.
- **Output:** same logical rows routed to plan-specific branch or generic overflow branch.
- **Notes:** off by default in V1.

#### `fanOutExplode`

- **Role:** materialize recipient-local rows only when required.
- **Input:** recipient-attached rows.
- **State:** none beyond local iteration buffers.
- **Output:** one row per `(recipient, row)` pair for recipient-dependent downstream work.
- **Notes:** placed as late as possible to preserve sparse fanout efficiency.

#### `consolidate`

- **Role:** multiset normalization/idempotence boundary.
- **Input:** diff rows that may arrive out of order (live + up-query).
- **State:** version/key scoped accumulation buffers.
- **Output:** consolidated diffs (net-zero canceled, deterministic ordering by version key).
- **Notes:** prepares stable append intent stream for sink classification/write.

**Consolidation semantics under partial state (V1):**

The consolidate operator must handle interleaving of live diffs and up-query response rows that may arrive at different versions and out of order. The precise semantics are:

1. **Accumulation.** For each `(output_key, row_fingerprint)` pair, the consolidator maintains a running multiplicity count. A `diff=+1` increments the count; a `diff=-1` decrements it. This is the standard Z-set accumulation from DBSP/Differential Dataflow.

2. **Version-gated emission.** The consolidator buffers accumulated diffs and emits them only when the per-scope logical frontier (Section 2.7) advances past the version of the buffered data. This ensures that all diffs for a given version — from both live data and up-query responses — have arrived before the consolidated result is emitted. The consolidator is the stability boundary in the graph: data upstream of it may be provisional, but data emitted by it is version-complete.

3. **Net-zero cancellation.** When the frontier advances, the consolidator examines all accumulated diffs for versions now closed. Pairs with net-zero multiplicity (e.g., a `+1` and `-1` for the same key and row data) are dropped. Remaining non-zero diffs are emitted in version order.

4. **Idempotence.** If the same diff arrives twice (e.g., due to up-query dedup races), accumulation naturally handles it — duplicate `+1`s produce multiplicity 2, which the sink's `row_multiset` tracking resolves correctly. The overlap-dedup at the source controller (Section 9.3) minimizes but does not need to perfectly eliminate duplicates.

#### `sinkWrite`

- **Role:** terminal output operator.
- **Input:** consolidated multiset diffs.
- **State:** output key-set store (V1 in-memory; V2 durable), producer session/write cursor metadata.
- **Output:** Durable Streams appends with idempotent producer headers + frontier/progress signals to proxy path.
- **Notes:** sole authority for wire-level insert/update/delete classification.

### 7.2.2 Composition examples

#### Example A: Basic single-table shape

Shape:

```sql
SELECT id, title, completed
FROM todos
WHERE list_id = $1 AND completed = false;
```

Lowering (logical -> physical):

```text
Input[todos]
  -> filter(list_id = $1)
  -> filter(completed = false)
  -> fanOutAttach(recipient index on list_id)
  -> consolidate
  -> sinkWrite
```

Behavior:

1. WAL `UPDATE` on `todos` enters as `-1 old` then `+1 new`.
2. Filters keep/drop each diff independently.
3. `fanOutAttach` computes affected shape recipients from reverse index.
4. `consolidate` cancels net-zero pairs where applicable.
5. `sinkWrite` classifies to insert/update/delete for the stream.

#### Example B: Shape with `WHERE ... IN (subquery)`

Shape:

```sql
SELECT i.id, i.title, i.project_id
FROM issues i
WHERE i.project_id IN (
  SELECT p.id
  FROM projects p
  WHERE p.active = true
);
```

Compiler lowering:

- `IN (subquery)` -> `semiJoin(issues.project_id = projects.id)`
- subquery predicate `p.active = true` becomes filter on right input

Physical composition:

```text
Input[issues] ------------------------------\
                                             -> semiJoin(issues.project_id = projects.id)
Input[projects] -> filter(active = true) ---/
                                             -> fanOutAttach
                                             -> consolidate
                                             -> sinkWrite
```

Why `semiJoin` here:

- Output needs only `issues` rows.
- Right side (`projects`) is used only for existence gating.
- Prevents row multiplication that a full join could introduce.

Up-query behavior on cold start / miss:

1. `semiJoin` may request missing right-side keys.
2. Adapter can use key-list mode (small miss set) or subquery mode (snapshot-scale miss set).
3. Fetch rows re-enter normal path; consolidated output remains idempotent.

### 7.3 Full-row policy

Rows are carried in their entirety through graph operators in V1. Column pruning still removes truly unused fields per edge, but operator contracts remain "row complete for this node." Final projection to the client's requested columns happens at the sink stage.

### 7.4 Shared graph and operator reuse

All shapes for a given tenant (upstream database) share a **single query graph**. When a new shape is compiled into a plan, the engine checks whether equivalent operators already exist in the graph and reuses them. Operators are reference-counted by downstream consumers. When the last consumer detaches, the operator and its state are removed.

This means if 10,000 shapes all filter the same table on the same column, there is one filter operator, not 10,000.

**Progress/wait scoping rule (required):** shared operators must track up-query wait state and frontier gating by **frontier scope** (per output/sink branch), not as one global pending set per operator. This prevents one slow shape snapshot/up-query from stalling unrelated shapes that reuse the same operator instance.

#### 7.4.1 Operator reuse matching algorithm

When a new shape is compiled into a physical plan, the engine must efficiently find reusable operators in the existing graph. V1 uses a **plan-signature trie**:

1. **Signature.** Each operator node in the physical IR has a canonical signature derived from: operator type, referenced table(s), predicate expression (normalized), column set, and join key(s). The signature is deterministic — two operators with the same logical behavior produce the same signature regardless of the order shapes were added.

2. **Trie structure.** The graph maintains a trie keyed by operator signatures, rooted at source controllers. To install a new plan, the engine walks the plan from source toward sink, matching each operator's signature against the trie. At the first mismatch (or at a node not yet in the trie), new operators are created for the remainder of the plan. All matched operators have their reference counts incremented.

3. **Matching scope.** Matching is per-source-controller subtree (not global). Two operators on different tables are never candidates for reuse.

4. **Cost.** Matching a new plan is O(plan depth × trie branch factor at each level), which is effectively O(plan depth) for typical plans. This does not degrade as the total number of shapes grows.

#### 7.4.2 Frontier scope scalability

Per-scope frontier tracking (Section 2.7) must scale to large shape counts on shared operators. V1 uses **frontier scope groups** to avoid per-shape tracking overhead:

- Shapes that share the same set of pending up-queries (typically: shapes with no pending up-queries) are grouped into a single frontier scope group. The group tracks one logical frontier for all its members.
- When a shape issues an up-query, it is moved to its own scope group (or to a group of shapes with the same pending set).
- When the up-query completes, the shape is merged back into the "clean" group.

In steady state (no pending up-queries), all shapes on a shared operator share **one** scope group. Scope groups proliferate only during active up-query traffic, and converge back to a small number as up-queries complete.

**Worst-case bound:** the number of active scope groups per operator is bounded by the number of concurrently pending up-queries on that operator, not by the number of shapes. Since pending up-queries are bounded by `max_inflight_upqueries_per_scope` (Section 3.2), scope group count is bounded.

### 7.5 Fanout design

**Fanout** is the mechanism that routes a single incoming change to the correct set of subscribing shapes. This is the most performance-critical part of the system because one table change might affect zero, one, or thousands of subscribers.

#### 7.5.1 Why not one output per subscriber?

Creating a separate processing branch per subscriber causes topology and backpressure explosion at target scale. With a million shapes, you cannot have a million branches.

#### 7.5.2 The attach/explode model

Galvanic splits fanout into two stages:

**`fanOutAttach`** — computes which subscribers (recipients) are affected by each row using a **reverse index** (a lookup structure mapping row values to interested subscribers). It annotates each row with its **recipient set** (the list of affected subscribers) but does not duplicate the row. One logical output stream continues, carrying rows tagged with their recipients.

**`fanOutExplode`** — materializes per-recipient copies of a row, but only when a downstream operator actually requires recipient-specific evaluation. This is placed as late as possible in the graph to avoid unnecessary duplication.

Between these two stages, an optional **`demuxByPlan`** operator can split processing into a bounded number of branches for backpressure isolation. This is off by default in V1.

#### 7.5.3 Recipient set representation

The recipient set attached to each row uses a hybrid container:

- **`SmallVec`** for small sets (common case: a change affects few subscribers).
- Promotes to **`RoaringBitmap`** for larger sets (efficient compressed set operations).
- Promotion threshold: default 64, configurable.

#### 7.5.4 Branch policy (when demux is enabled)

- `demux_enabled = false` by default, configurable.
- `max_branches_per_fanout = 64` when demux is enabled, configurable.
- Overflow shapes route to a generic branch.
- Generic branch scheduling: strict fair (V1).
- No live branch promotion/demotion in V1.
- Reassignment: delete shape graph state and lazily recreate on next request.

#### 7.5.5 Fanout placement diagram

```text
[source changes]
      |
      v
[map/filter/join/semiJoin]
      |
      v
[fanOutAttach] -- computes recipient_set via reverse index
      |
      +--> (optional) [demuxByPlan]
                |          |          |
                v          v          v
             [branch A] [branch B] [generic branch]
                |          |          |
                +----------+----------+
                           |
                           v
                 [fanOutExplode only when
                  recipient-local ops needed]
                           |
                           v
                    [post-recipient ops]
                           |
                           v
                        [sinkWrite]
```

---

## 8. Up-query model

### 8.1 What is an up-query?

An **up-query** is a request from a downstream operator to an upstream data source for data that the operator doesn't currently have. This is how the system handles **partial state**: operators don't need to hold the entire dataset in memory. When they encounter a gap — for example, a join operator receives a row but doesn't have the matching row from the other side — they issue an up-query to fetch it.

### 8.2 Snapshots are up-queries

When a new shape is attached, it needs an initial snapshot of the current data. Rather than having a separate snapshot mechanism, the initial snapshot uses the same up-query mechanism. The output requests a snapshot via an up-query; once the snapshot rows arrive (as `Row` messages with `diff=+1` and `upquery_ids` set), normal maintenance continues.

Critically, live rows are **not** held back waiting for the snapshot to complete. They flow immediately. Downstream consumers know the data is provisional until a frontier covers it.

### 8.3 Backward routing through the graph

Up-queries travel **backwards** through the dataflow graph — from the operator that needs data, upstream through each intermediate operator, until they reach a source controller (Section 9.3) that can fulfill the request against the database.

Each operator in the path has the opportunity to **augment** the up-query as it passes through. This means the up-query accumulates context from every operator it traverses, so that the source controller receives a richly specified request that can be compiled into an efficient SQL query. The source controller never receives a bare "give me everything" — it receives a predicate that reflects the combined logic of all downstream operators.

The up-query carries a **structured predicate** (not a SQL string) that operators build up incrementally. The source controller is responsible for the final step of compiling this structured predicate into a database query.

#### 8.3.0 Backward channel mechanism

The backward path uses **per-operator up-query inboxes** — Tokio mpsc channels that mirror the graph topology in reverse:

```text
Forward data plane (Timely edges):
Source ──────> Filter ──────> Join ──────> FanOut ──────> Sink

Backward up-query path (Tokio mpsc channels):
Source <────── Filter <────── Join <────── FanOut <────── Sink
  ↑ inbox        ↑ inbox        ↑ inbox        ↑ inbox
```

Each operator holds:

- A **receiver** for its own up-query inbox.
- **Sender handle(s)** to parent up-query inbox(es) — one per upstream input. Most operators have one parent; join and semi-join operators have two (left and right), and select which parent to forward to based on the query-back-side rule (Section 8.3.2).
- **Timely `Activator` handle(s)** for parent(s) — one per upstream input, to wake the target parent when a backward message is posted.

When an operator issues or forwards an up-query:

1. It augments the predicate according to its operator type (Section 8.3.1).
2. It sends the augmented up-query to its parent's inbox via the Tokio sender.
3. It calls the parent's Timely activator to ensure the parent is scheduled.

When an operator is scheduled by Timely (either because forward data arrived or because it was activated), its `run()` method drains both:

- **Timely input handles** — forward data (live rows and up-query response rows).
- **Backward inbox** — pending up-query requests from downstream operators.

For forward data, rows carrying `upquery_ids` are identified as up-query responses and matched against pending up-query tracking state. For backward requests, the operator augments the predicate and forwards it upstream.

The full round-trip for an up-query:

```text
1. Join detects miss during forward processing
   → retains Timely capability for t=101
   → creates UpQuery{predicate: "issues WHERE project_id = ?", keys: [7]}
   → posts to Filter's backward inbox + activates Filter

2. Filter is scheduled by Timely (via activator)
   → drains backward inbox
   → augments predicate: "issues WHERE project_id = ? AND active = true"
   → posts to Source Controller's backward inbox + activates Source Controller

3. Source Controller is scheduled
   → compiles predicate to SQL: SELECT * FROM issues WHERE project_id = 7 AND active = true
   → issues async query via Tokio (snapshot pool connection)
   → returns from run()

4. Query response arrives (Tokio async completion)
   → Source Controller injects response rows into Timely as forward data:
     Row { data: {...}, diff: +1, version: v102, upquery_ids: {U1} }

5. Rows flow forward through Timely edges:
   → Filter applies predicate, passes matching rows
   → Join receives response rows, matches upquery_ids to pending U1,
     processes through join logic, clears pending state
   → Join drops capability for t=101
   → Timely automatically advances the physical frontier
   → Galvanic per-scope logical frontier advances for affected scopes (Section 2.7)
```

This keeps the backward traversal in the graph — each operator participates in predicate augmentation hop-by-hop — while using Timely's native mechanisms (capabilities, activators, forward edges) for progress tracking and response delivery.

#### 8.3.1 Per-operator augmentation rules

Each operator type transforms the up-query predicate as it passes through:

**`filter`** — Adds its own predicate as an additional `AND` clause. For example, if a filter checks `active = true`, any up-query passing through it gains `AND active = true`. This is the most straightforward augmentation: the source controller will only query rows that satisfy the filter, avoiding fetching data that would be immediately discarded.

**`project`** — May annotate required columns, allowing the source controller to limit the column set in its query. (Note: in V1 with full-row policy, this is informational rather than restrictive.)

**`map`** — If the map applies a transformation to columns referenced in the up-query predicate, it must reverse-map those column references so the predicate is expressed in terms of the source columns, not the transformed ones.

**`semiJoin`** — Behaves like a filter from the left (preserved) side: adds the existence condition. See Section 8.3.2 for details.

**`join`** — The most interesting case. See Section 8.3.2.

**`fanOutAttach` / `fanOutExplode`** — Strips recipient-set information. Up-queries are about data content, not subscriber routing.

#### 8.3.2 Join up-query modes

When a join operator needs to issue an up-query, it faces a choice about how to express the request to the other side of the join. There are two modes:

**Mode A — Key-list (Noria-style):** The join examines data it already has on one side, extracts the join keys, and issues an up-query to the other side with a predicate like `column IN [key1, key2, key3, ...]`. This is simple and works well when the key set is small. However, for large key sets (thousands of keys), the resulting `IN (...)` list becomes unwieldy.

**Mode B — Subquery pushdown:** Instead of materializing a list of keys, the join emits a **structured subquery predicate** that describes how to compute the key set. For example, rather than:

```
issues WHERE project_id IN [1, 3, 7, 42, ...]
```

the join can emit:

```
issues WHERE project_id IN (SELECT id FROM projects WHERE active = true)
```

This pushes the join back to the database, letting Postgres use its own query optimizer to execute the join efficiently. The subquery itself is the accumulated predicate from the upstream path (including any filter augmentations).

This is particularly powerful for **initial snapshots**, where the key set may be the entire filtered contents of a table. Rather than first querying all project IDs and then issuing a second query with a huge `IN` list, the source controller issues a single query with a subquery join.

**When to use which mode:**

- Key-list mode is preferred when the key set is already known and small (e.g., a join miss for a single row during live maintenance).
- Subquery mode is preferred for initial snapshots and large-scale up-queries where the key set is derived from another table's filtered state.
- The choice can be made dynamically based on whether the upstream predicate is available as a structured expression vs. a materialized key set.

**Adapter capability gating:** Subquery pushdown requires the adapter to support compiling structured subquery predicates into SQL. This is declared in the adapter's `CapabilitySet`. Adapters that don't support it (e.g., a simple key-value store) fall back to key-list mode.

**Join query-back-side rule (required for correctness):**

- For each up-query path that crosses a join, the planner must choose **one query-back side** for that path.
- **Inner join (V1):** either side is valid, but exactly one side is selected per path.
- **Left join / right join (V2):** query-back side must be the preserved side.
- The opposite side is consulted via normal join lookups while processing the up-query response.
- A single logical up-query path must never issue symmetric "full current-state fetch" requests to both ancestors of the same join, as that risks duplicate effects and race amplification.

#### 8.3.3 Example: up-query through a filter and join

Consider this graph for a shape "issues where project.active = true":

```text
[Input: projects] --> [Filter: active=true] --\
                                                --> [Join: projects.id = issues.project_id] --> [Output]
[Input: issues] ------------------------------/
```

When the output requests an initial snapshot:

1. The **output** emits an up-query: "I need all matching rows."

2. The **join** receives the up-query. For this path, planner chooses **projects (left)** as the query-back side.
   - **Left side (projects):** send up-query upstream through the filter.
   - **Right side (issues):** no symmetric full current-state fetch request for this same path.

3. The **filter** receives the left-side up-query and augments it: adds `AND active = true` to the predicate.

4. The **projects source controller** receives the augmented up-query: "give me all projects where active = true." It compiles this to SQL and issues the query-back.

5. Query-back rows from projects flow back through the join. The join performs lookups into issues state for each returned row.

6. If a lookup misses in issues state, the join triggers a **dependent up-query** to issues for just the missing join keys, and then re-runs the original up-query path once holes are filled (Section 8.3.4).

All source query-backs use the single-statement capture pattern (Section 9.5) to get consistent snapshot + LSN resolution.

```text
Up-query flow (backward through graph):

Output
  | "give me all rows"
  v
Join
  | query-back side: left (projects)
  v
Filter
  | augments: AND active=true
  v
Input: projects
  | compiles to SQL:
  | SELECT * FROM projects WHERE active = true
  v
[query-back to Postgres]
  |
  v
Join processing of returned rows
  | lookup in issues state by project_id
  | miss? -> dependent up-query for missing keys
  v
Input: issues (key-list or subquery mode for dependent misses)
```

#### 8.3.4 Dependent up-queries, hole tracking, and redo

When processing an up-query response through a join, lookups into the opposite side may encounter missing state ("holes"). In this case:

1. Record hole wait state: `waiting_holes[hole_key] += upquery_request_id`.
2. Issue dependent up-query for each distinct hole key (deduplicated).
3. Do **not** emit partial up-query output for that `upquery_request_id` yet.
4. When all holes for `upquery_request_id` are marked filled, enqueue a **redo** of the original up-query request.
5. Emit downstream up-query output only from the successful redo pass.

Required properties:

- If two up-queries hit the same hole, request one dependent up-query but redo both original requests.
- If one up-query hits multiple holes, redo once only after all are filled.
- Redo scheduling must respect per-scope up-query refill concurrency limits and avoid starvation.

This prevents deadlock and avoids exposing partial up-query effects.

### 8.4 Response routing

Up-query responses (rows with `diff=+1` and `upquery_ids` set) carry the set of up-query IDs that the response satisfies. Because in-flight up-queries are deduplicated — multiple requests with the same `(operator, predicate/key, request_class, version_bucket)` are coalesced into a single query-back — a single batch of fetch rows may resolve several waiting up-queries at once. The response carries all of their IDs.

This tagging is essential for two reasons:

1. **Routing.** Each operator on the return path (downstream from the source controller) can identify which of its pending up-queries a fetch row belongs to and process it accordingly. For example, a join operator knows which side's up-query the rows are answering and can match them against data from the other side.

2. **Completion tracking.** Operators track which `upquery_id`s they are waiting on. When `UpQueryComplete` arrives, it likewise carries the full set of coalesced IDs. Each waiting operator checks whether any of its pending IDs are in the set and clears them accordingly.

Response rows flow **downstream** through the normal data path (source controller → operators → sink), following the same graph edges as live data. The `upquery_ids` field distinguishes them from live changes. Operators process fetch rows through the same logic as live diffs (applying filters, performing joins), which ensures consistency — a fetch row that doesn't match a filter is dropped just as a live diff would be.

### 8.4.1 Union and shard-merger up-query response assembly

Up-query responses that pass through a union/shard-merger require piece assembly:

- Buffer response pieces by `(response_group_id, lookup_key)`.
- A response group is defined as: up-query plan ID + path suffix below this union.
- Emit assembled up-query output only after all required parent pieces for the group/key are present.
- While buffered, merge relevant live deltas into buffered response state for parents that have already responded.

Shard-specific rules:

- Narrow response routing: if up-query target is a specific shard, the last sharder must unicast response to that shard only.
- Broad response routing: if up-query expects all shards, shard merger waits for all shard pieces.
- Up-query slot accounting must release capacity by the number of satisfied upstream requests, not blindly by one response.

This avoids response-assembly deadlocks and duplicate/missing effects across merged paths.

### 8.5 Operator wait tracking

- Operators track in-flight `upquery_id`s by **frontier scope** (`scope -> pending IDs`).
- State retention considers outstanding up-queries (state needed by pending up-queries is not evicted).
- Frontier advancement for scope `S` is gated only by pending IDs in `S`.
- Once the matching `UpQueryComplete` arrives and relevant frontiers pass, state can be garbage-collected.
- Join operators additionally track `waiting_holes` and `redo_queue` for dependent up-query handling (Section 8.3.4).

### 8.5.1 Incongruent join eviction rule (required)

When a join is on key `Kj` but a downstream up-query path is keyed by `Kr != Kj` (incongruent path), a miss on the opposite side while processing a live delta cannot be safely dropped without risking stale downstream state.

Required behavior:

- Detect up-query paths through the join whose partial key is incongruent with join key.
- On such a miss, issue scoped downstream evictions for affected up-query keys before dropping/deferring the delta.
- Limit eviction to the minimal affected up-query scopes/paths.

This preserves eventual correctness under partial state when join misses occur on non-join up-query keys.

### 8.6 Failure behavior

If an up-query fails:

1. Classify the failure (`transient` vs `permanent`).
2. For **transient** failures (timeouts, retryable transport/database errors), retry with bounded backoff (`max_upquery_retries`, default 3) while keeping blast radius scoped to the affected frontier scope.
3. For **permanent** failures (unsupported query shape/capability mismatch, hard schema incompatibility), fail the waiting scope and invalidate only dependent shapes.
4. If bounded retries are exhausted, escalate to the same scoped invalidation path as permanent failures.

This keeps fail-fast semantics for non-recoverable errors, but avoids tearing down healthy shapes on short transient faults.

### 8.7 Snapshot/live interleaving timeline

```text
time ---->

live Row(diff=+1, v=101) -------------------> sink (provisional; no frontier yet)
live Row(diff=+1, v=102) -------------------> sink (provisional; no frontier yet)
snapshot Row(diff=+1, uqids, v=98) ---------> sink (consolidate resolves ordering)
snapshot Row(diff=+1, uqids, v=100) --------> sink
UpQueryComplete(ids, v=103) ----------------> operator/sink
Frontier(v=103) ----------------------------> marks stable state through v=103
```

---

## 9. Ingest and database adapters

### 9.1 What is an adapter?

A **database adapter** is the bridge between a specific database and the engine. It translates database-specific change events into the engine's internal format and handles database-specific operations like fetching historical data.

### 9.2 Adapter contract

Each adapter provides:

- **Change stream ingestion** — reading the database's change feed (e.g. Postgres WAL, MySQL binlog).
- **Version extraction/comparison** — mapping database-native versions to the engine's version model.
- **Frontier production** — emitting progress markers based on replication progress.
- **Up-query execution** — running queries against the database to fetch historical data.
- **Type mapping and key extraction** — converting database types and identifying primary keys.

### 9.3 Per-table source controllers

Although a single Postgres replication connection delivers all changes across all tables in one stream, the engine does not treat this as a single monolithic input. Instead, the adapter **demultiplexes** the replication stream into a separate **source controller** per table (relation). Each source controller is a distinct input node in the dataflow graph.

This per-table split matters for several reasons:

- **Multiset conversion.** The source controller is responsible for converting WAL events into the graph's multiset diff format. A WAL `INSERT` becomes a single `+1` row. A WAL `UPDATE` is decomposed into a `-1` of the old row followed by a `+1` of the new row. A WAL `DELETE` becomes a `-1`. This conversion means all downstream operators work exclusively with `+1/-1` diffs and never see raw database operations.

- **Up-queries are table-scoped.** When a downstream join operator needs missing data from the `users` table, the up-query is routed to the `users` source controller, which issues the query-back SQL and splices the results into its own output stream. The source controller owns the query-back lifecycle for its table. Up-query (fetch) responses are emitted as `+1` diffs — they are inserting the fetched state into the graph.

- **Overlap deduplication (query-back vs WAL).** A source controller suppresses only overlap duplicates between query-back packets and replication transactions. Dedupe is **not** keyed by primary key alone. The dedupe key is `(origin, packet_or_tx_id, pk, row_fingerprint, diff)` where:
  - `origin` is `wal` or `upquery(packet_id)`,
  - `packet_or_tx_id` is the query packet ID or source transaction identity,
  - `row_fingerprint` is a stable hash of the emitted row image used for overlap suppression.
    This prevents accidental suppression of legitimate update transitions (`-1 old` then `+1 new`) on the same PK. This state is **session-local** and resets cleanly on restart; sink classification still owns wire-level insert/update/delete semantics (see Section 12.4).

- **Frontier production is per-table.** Each source controller emits its own frontiers based on replication progress and its own pending up-queries. This allows tables with no pending work to advance their frontiers independently of tables still waiting on query-back responses.

```text
Postgres replication connection (single)
        |
        | (demux by relation/table)
        |
        +---> [source controller: todos]   ---> graph input (todos)
        |       - WAL → multiset conversion
        |       - overlap dedup ledger
        |       - pending up-queries
        |       - frontier state
        |
        +---> [source controller: users]   ---> graph input (users)
        |       - WAL → multiset conversion
        |       - overlap dedup ledger
        |       - pending up-queries
        |       - frontier state
        |
        +---> [source controller: lists]   ---> graph input (lists)
                - WAL → multiset conversion
                - overlap dedup ledger
                - pending up-queries
                - frontier state
```

### 9.4 Postgres adapter specifics

- Consumes the Postgres logical replication stream (LSN ordered) on a single dedicated connection.
- Demultiplexes into per-table source controllers as described above.
- Emits source frontiers from replication progress.
- Performs query-back with snapshot/barrier semantics (see Section 9.5).
- V1 assumes full-row semantics for graph processing.

**V1 requirement: `REPLICA IDENTITY FULL`.** Galvanic V1 requires `REPLICA IDENTITY FULL` on all replicated tables. This ensures:

- **Complete old row images.** WAL `UPDATE` events include the full old row, which the source controller needs to emit the `-1` retraction diff. Without `REPLICA IDENTITY FULL`, the old image may only contain the primary key columns, making multiset diff decomposition incomplete.
- **TOAST column inclusion.** With `REPLICA IDENTITY FULL`, Postgres includes TOAST column values in the WAL even when those columns are unchanged. This eliminates the `UnchangedToast` case during normal replication — every row image is complete. The `UnchangedToast` variant in `RawCellRef` is retained as a defensive fallback but should not occur under correct configuration.
- **Consistency with current Electric.** The current Elixir-based sync service has the same requirement, so this is not a new constraint for existing users.

This is an adapter-level concern — the core engine does not depend on Postgres-specific constructs. Future adapters for databases with different change-image semantics declare their image fidelity in their `CapabilitySet` (Section 6.7). A V2/V3 Postgres adapter could relax this requirement by handling partial old images through targeted query-back for missing columns, but V1 avoids this complexity.

### 9.5 Query-back and LSN resolution (Postgres)

When a source controller issues an up-query (query-back) to Postgres, it needs to know **where in the replication stream** to splice the result. The replication stream is ordered by LSN (Log Sequence Number — a monotonically increasing pointer into the Write-Ahead Log). The query-back result must be placed at a coherent point relative to the live stream so that downstream operators see a consistent ordering.

The core difficulty is that a SQL query runs against an MVCC snapshot (defined by transaction visibility rules), but the replication stream is ordered by WAL position. These two orderings — transaction-ID space and LSN space — do not have a simple reversible mapping. A transaction's commit record may land at a WAL position far from where the snapshot was taken.

#### 9.5.1 The single-statement capture pattern

To get a coherent query-back result, the adapter runs the data query, an MVCC snapshot descriptor, and a WAL barrier marker **in a single SQL statement**. This is critical because under `READ COMMITTED` isolation (the Postgres default), each statement gets a fresh snapshot — running them as separate statements would not guarantee they share the same visibility.

```sql
WITH meta AS (
  SELECT
    pg_current_snapshot()        AS snap,
    pg_current_wal_insert_lsn()  AS barrier_lsn
)
SELECT
  meta.snap,
  meta.barrier_lsn,
  q.*
FROM meta
JOIN LATERAL (
  SELECT ... -- the up-query / lookup
) q ON true;
```

This yields a **query packet** containing:

- `snap` = `(xmin, xmax, xip_list)` — the MVCC snapshot descriptor, which records which transactions were in-progress at query time.
- `barrier_lsn` = a WAL position that is guaranteed to be at or after the point where the snapshot was taken. This is **not** "the LSN of the snapshot" — it is a safe upper-bound marker.
- `rows` = the query results.

#### 9.5.2 Placing the result in the replication stream

The source controller uses a two-path algorithm to decide when to emit the query-back rows into its output stream:

**Path 1 — Tight placement (preferred).** While consuming the replication stream, the controller examines each transaction's XID (transaction ID). A transaction is **definitely after** the query snapshot if:

- Its XID appears in `xip_list` (it was in-progress when the snapshot was taken, so its commit is necessarily after the snapshot), OR
- Its XID ≥ `xmax` (it hadn't even started when the snapshot was taken).

The first such transaction is `T_first`. The query-back rows are emitted **immediately before** `T_first`, placing them as early as possible after the snapshot boundary.

**Path 2 — Quiet-database fallback.** If the database goes quiet and no post-snapshot transaction ever appears in the replication stream, the controller falls back to the `barrier_lsn`. The controller may emit at fallback only after both conditions hold:

1. replication progress reaches the barrier (`max(last_end_lsn_seen, last_wal_end_seen) >= barrier_lsn`), and
2. the connection is caught up with no buffered commit records with end-LSN `<= barrier_lsn` left to deliver.
   Then the controller emits the query-back rows at that point.

This guarantees a deterministic insertion point even when no new transactions occur, without requiring a heartbeat write to the database.

#### 9.5.3 Algorithm state machine

```text
When a source controller issues a query-back:
  1. Run single-statement query → get (snap, barrier_lsn, rows)
  2. Enqueue pending packet Q = {snap, barrier_lsn, rows, inserted=false}

While streaming replication:
  For each transaction T (with XID from BEGIN, commit LSN from COMMIT):
    Update last_end_lsn_seen from COMMIT
    For each pending packet Q (not yet inserted):
      If T.xid ∈ Q.snap.xip_list  OR  T.xid >= Q.snap.xmax:
        Emit Q.rows immediately before T
        Mark Q.inserted = true

  On keepalive / idle / caught-up signals:
    Update last_wal_end_seen
    For each pending packet Q (not yet inserted):
      If max(last_end_lsn_seen, last_wal_end_seen) >= Q.barrier_lsn
         AND no buffered commits with end-LSN <= Q.barrier_lsn remain:
        Emit Q.rows now
        Mark Q.inserted = true
```

#### 9.5.4 Practical considerations

- XID comparisons must be **wraparound-safe** (XIDs are modulo 2³²).
- Large `xip_list` values (from high-concurrency workloads) need an efficient membership structure (hash set, bitset, or sorted array with binary search).
- The algorithm inserts relative to **transaction boundaries**, which matches pgoutput's delivery model (changes are delivered per-transaction with a commit point).
- `walEnd`/keepalive-based fallback is valid only with the "no buffered commits <= barrier remain" gate above; this avoids early insertion if commit decoding/output is lagging in-process.
- The source controller's overlap-dedup tracking (Section 9.3) ensures that rows already delivered via the replication stream are not duplicated when the query-back result is spliced in, and vice versa.

### 9.6 Other databases

MySQL/MongoDB adapters can vary in change-image fidelity and version semantics. The core engine only requires that the adapter fulfills the adapter contract and provides version-order guarantees — it does not require Postgres-specific constructs. Each database adapter implements its own query-back LSN/version resolution strategy appropriate to its change-stream model.

### 9.7 Internal data representation (RowEnvelope)

#### 9.7.1 Why not JSON internally?

JSON is an output/wire format, not the internal row format. Using JSON internally would mean:

- Repeated serialize/deserialize overhead in hot paths.
- Forced parsing of fields that many operators never read.
- Database-specific coupling (JSON representation varies by database).

Instead, engine operators consume **row envelopes** with raw cell payloads and lazily decode only the fields they access.

#### 9.7.2 Envelope model (V1)

```rust
struct RowEnvelope<V> {
    relation_id: RelationId,
    diff: i8,                        // +1 or -1 (multiset semantics)
    version: V,
    key: Option<KeyBytes>,
    data: RowImageRef,               // the row payload
    upquery_ids: Option<UpQueryIdSet>, // present on fetch rows only
    meta: RowMeta,
}

struct RowImageRef {
    schema_id: SchemaId,
    raw: Arc<RawRow>,
    decoded_cache: Arc<DecodedCache>,
}

enum RawCellRef {
    Null,
    Text(Bytes),
    Binary(Bytes),
    UnchangedToast,   // defensive fallback; should not occur under REPLICA IDENTITY FULL (V1 requirement)
}
```

Key properties:

- **Multiset diffs, not operations.** The `diff` field is `+1` (insertion) or `-1` (retraction). There is no `Insert`/`Update`/`Delete` enum inside the graph. Updates are decomposed at the source controller into a `-1` of the old row and a `+1` of the new row. The sink reconstructs insert/update/delete semantics for the wire protocol using its output state store (see Section 12.4.1–12.4.2).
- `raw` is immutable and shareable across operators (zero-copy for reads).
- `decoded_cache` is a per-row-image lazy cache keyed by column ID — a field is decoded once on first access and cached for subsequent reads.

#### 9.7.3 How operators access data

```text
WAL / Query-back row
        |
        v
RowEnvelope {
  diff: +1|-1
  data -> RowImageRef(raw bytes + decoded_cache)
}
        |
        +--> map/filter/project asks for col X
        |        |
        |        +--> cache hit? yes -> typed value
        |        |
        |        +--> no -> decode raw cell X -> cache -> typed value
        |
        +--> join/semiJoin asks for join key cols only
        |
        +--> fanOutAttach asks for guard/index cols only
        |
        v
sink/consolidate requests output fields -> final JSON encoding
```

Operators access fields via accessor APIs, not by deserializing entire rows:

```rust
trait RowAccess {
    fn raw(&self, col: ColId) -> Option<&RawCellRef>;
    fn decoded<T: 'static>(
        &self,
        col: ColId,
        codec: &dyn Codec,
    ) -> Result<Option<&T>, DecodeError>;
    fn diff(&self) -> i8;  // +1 or -1
}
```

Rules:

- Stateless `map`/`filter`/`project` should request only referenced columns.
- `fanOutAttach` should primarily touch key/guard/index columns.
- `fanOutExplode` should preserve envelope sharing where possible and avoid deep copies.

#### 9.7.4 JSON/JSONB handling

JSON/JSONB columns are kept raw initially. Decoding is lazy at two levels:

- Column-level parse on first access.
- Nested/path parse on first child access where practical.

This avoids paying parse cost for unused nested fields.

#### 9.7.5 Ingest/query-back implications

- WAL ingest already arrives as field tuples and maps cleanly into raw cells.
- Query-back should avoid building full JSON rows in SQL for engine-internal use.
- The Postgres adapter should fetch typed row fields and build `RowEnvelope` directly.
- JSON encoding happens as the final step before Durable Stream append or HTTP emission.

#### 9.7.6 V1 rollout strategy

1. Introduce `RowEnvelope`/`RawCellRef` and keep operator behavior functionally equivalent.
2. Implement lazy decode cache and switch predicate/project/join accessors to on-demand decode.
3. Add metrics: decode calls, cache hit rate, bytes decoded per operator.
4. Keep optional compatibility mode for adapter/query-back JSON rows during migration, but default to non-JSON envelope mode.

---

## 10. Sink path and Durable Streams

### 10.1 What is the sink?

The **sink** is the final stage of the dataflow graph. It takes the engine's output, projects it to the client's requested schema, consolidates changes, and writes them to a Durable Stream — the persistent, append-only log that the proxy reads from to serve clients.

### 10.2 Output pipeline

1. **Project** to output schema (supports partial-row emission — clients may only want certain columns).
2. **Consolidate** diffs in a version-aware, idempotent manner (handles out-of-order arrival between live and up-query rows). Net-zero diff pairs for the same key and data are cancelled; remaining diffs are ordered by version.
3. **Classify** diffs into wire-protocol operations using the sink output state store (Section 12.4.1–12.4.2). The graph delivers multiset diffs (`+1`/`-1`); the sink maintains per-shape output row state and classifies from **state transitions** (`previous visible row` -> `next visible row`) rather than boolean key presence. This is robust under joins and multiplicities where multiple rows can share a key. In **V1** this store is in-memory and reset on crash; in **V2** it is durable and survives restart to support resumable continuation.
4. **Append** to Durable Stream with idempotent producer headers. In V2, state mutation and append-intent persistence are atomic in local storage before external append (crash-safe ordering — see Section 12.4.2).

### 10.3 Exactly-once semantics

Durable Streams provides idempotent producer semantics through three headers:

- **`Producer-Id`** — identifies the producing engine instance.
- **`Producer-Epoch`** — a monotonic counter that fences stale producers.
- **`Producer-Seq`** — a sequence number that detects duplicates and gaps.

Server responses drive producer recovery behavior:

- `200/204` — success.
- `403` — stale epoch fencing (another producer has taken over).
- `409` — sequence gap detected (expected vs. received headers returned).

**V1 guarantee:** Exactly-once for in-process retry/replay-to-sink attempts. Crash continuation to the same stream is not guaranteed — the stream is reset on crash.

**V2 guarantee:** Exactly-once across crash/restart by persisting the recovery cursor, producer session state, and pending append intents, then replaying with stable producer sequencing on restart.

### 10.4 Stream/shape handle policy

- Deleting a shape's graph does not require immediate deletion of its Durable Stream data.
- A recreated shape receives a **new stream ID** (acts as a cache buster).
- The old stream ID is immediately unavailable — no grace period or TTL.
- Only minimal tombstone/redirect metadata is kept, sufficient to return protocol-correct stale-handle responses.
- `offset=-1` and the current Electric protocol resolve to the latest handle path.
- Stale handle flow follows the current Electric protocol (409 + redirect semantics).
- Sealed streams are garbage collected via `delete_stream` after a configurable retention window (`sealed_stream_retention`, default 24h). The retention window allows lagging proxies/CDN caches to drain before the stream data is removed.

### 10.5 Durable Streams interface contract

Durable Streams is a separate service with its own design document. This section specifies the interface contract that the Galvanic engine and proxy depend on.

#### 10.5.1 Writer interface (engine → Durable Streams)

| Operation                                        | Semantics                                                                                                                                                                                                                                    |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_stream(stream_id)`                       | Create a new append-only stream. Returns error if stream already exists.                                                                                                                                                                     |
| `append(stream_id, entries[], producer_headers)` | Append one or more entries to the stream. Entries are opaque byte payloads (JSON-encoded wire-protocol operations). Producer headers (`Producer-Id`, `Producer-Epoch`, `Producer-Seq`) provide idempotent producer semantics (Section 10.3). |
| `seal_stream(stream_id)`                         | Mark the stream as complete (no further appends). Used when a shape is removed and replaced with a tombstone.                                                                                                                                |
| `delete_stream(stream_id)`                       | Remove the stream and its data. Returns success even if the stream does not exist (idempotent). Used for garbage collection of sealed/tombstoned streams after the retention window expires.                                                 |

**Append failure modes:**

- **Success (200/204):** entries appended, producer seq advanced.
- **Fenced (403):** a newer producer epoch has taken over this stream. The engine must stop writing and yield. This occurs during failover or restart.
- **Sequence gap (409):** the expected producer sequence number does not match. Response includes the expected value so the engine can detect missed or duplicate appends and retry or reset accordingly.
- **Stream not found (404):** the stream was deleted or never created. The engine must re-create the stream (new stream ID) and re-sync the shape.
- **Transient errors (5xx):** retry with bounded backoff.

#### 10.5.2 Reader interface (proxy → Durable Streams)

| Operation                       | Semantics                                                                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read(stream_id, offset, live)` | Read entries starting from `offset`. If `live=true`, long-poll for new entries (tail the stream). Returns entries + current stream offset for ETag/cache semantics. |
| `stream_info(stream_id)`        | Return metadata: current length, sealed status, chunk boundaries. Used by the proxy for cache headers and offset resolution.                                        |

**Read failure modes:**

- **Stream not found (404):** proxy returns 409 to client (stale handle, must re-subscribe with `offset=-1`).
- **Offset out of range:** proxy returns appropriate error; client must re-subscribe.

#### 10.5.3 Required guarantees

- **Durability:** once an append returns success, the data must survive Durable Streams process restarts.
- **Read-after-write:** after a successful append, subsequent reads at that offset must return the appended data.
- **Ordering:** entries within a stream are totally ordered by append sequence. Reads return entries in append order.
- **Chunk boundaries:** the stream exposes stable chunk/offset boundaries suitable for HTTP ETag and CDN caching semantics. The proxy maps these to the Electric wire protocol's chunk model.

---

## 11. Control-plane behavior

The **control plane** manages the lifecycle of shapes — how they are added, removed, and recovered.

### 11.1 Shape add

1. Compile the shape definition to canonical IR.
2. Optimize and produce a physical plan.
3. Deduplicate against existing graph operators (reuse where possible).
4. Install new operators and increment reference counts.
5. Create or attach an output sink stream.

### 11.2 Shape remove

1. Detach the sink/output.
2. Decrement reference counts upstream.
3. Recursively remove operators whose reference count reaches zero.
4. Write tombstone/redirect metadata only (old stream ID becomes immediately unavailable for reads).

### 11.3 Lazy recreate

- No prewarm.
- No overlap dual-run (old and new running simultaneously).
- Recreation occurs only when the shape is requested again.

### 11.4 Shape lifecycle diagram

```text
                    +--------------------+
request shape ----> | compile + optimize |
                    +---------+----------+
                              |
                              v
                    +--------------------+
                    | dedupe in graph    |
                    +----+-----------+---+
                         |           |
              reused ops |           | new ops
                         v           v
                     +--------------------+
                     | attach sink/stream |
                     +---------+----------+
                               |
                               v
                          serving live
                               |
remove shape ------------------+
                               v
                    +--------------------+
                    | detach sink        |
                    | dec refs + GC ops  |
                    +---------+----------+
                              |
                              v
                    recreate on next request
                    (new stream id / handle)
```

### 11.5 Schema changes (DDL handling)

The Postgres replication stream includes **relation messages** when a table's schema changes (columns added, removed, type changed, etc.). The adapter detects these and triggers the following flow:

**V1 policy: invalidate and rebuild.**

1. The adapter receives a relation message indicating a schema change for table `T`.
2. All shapes whose plans reference table `T` are **invalidated**: their sinks are detached, operator reference counts are decremented, and operators with zero references are removed.
3. The adapter updates its internal schema catalog for `T`.
4. Invalidated shapes are **not** automatically re-created. They are lazily re-created on next client request (consistent with Section 11.3).
5. A re-created shape receives a new stream ID. Clients using the old stream ID receive a 409 stale-handle response and must re-subscribe (consistent with Section 10.4).

**What is not supported in V1:**

- In-place schema migration (keeping the shape alive across the DDL change).
- Automatic re-compilation of shapes against the new schema without client re-request.
- Concurrent-safe DDL where the old schema serves reads while the new schema compiles.

These are V2/V3 candidates. V1 treats DDL as a rare event that justifies shape rebuild.

**Relation message ordering:** Postgres delivers relation messages before the first data message that uses the new schema in the replication stream. The adapter must process the relation message and update its schema catalog before processing subsequent data rows for that table, or it will misparse the new row format.

---

## 12. Runtime, sharding, and scheduling

### 12.1 Execution model

- One shared graph per tenant database.
- Stateful operators (joins, semi-joins) are sharded by key.
- Stateless operator chains may be fused for efficiency.
- Avoid singleton bottlenecks where possible.
- Keep attach mode (annotate rows with recipients, don't duplicate) until recipient-local work is unavoidable.

### 12.2 Tenant-scoped connection subsystem

Each tenant (upstream database) gets its own connection subsystem with:

- **One replication connection** — for CDC ingest, non-pooled (must be dedicated).
- **One admin pool** — for DDL, publication management, and control operations.
- **One snapshot pool** — for query-back/up-query reads.

This isolation:

- Prevents noisy tenants from affecting each other.
- Separates long-running snapshot/query-back traffic from control-plane SQL.
- Enables lower-privilege pooled read users while preserving admin capabilities where needed.

**Sizing policy (initial defaults):**

- Configure `total_pool_size` per tenant.
- Derive pool split:
  - `admin = clamp(total_pool_size / 4, min=1, max=4)`
  - `snapshot = max(total_pool_size - admin, admin)`
- Allow per-tenant overrides.

**Queueing policy:**

- `snapshot` pool: longer queue tolerance (query-back can be bursty/long-lived).
- `admin` pool: fast-fail/short queues for control responsiveness.

**Failure policy:**

- If either pool cannot reach target healthy connections, mark the tenant subsystem degraded and restart it.
- Keep the failure domain tenant-local (no cross-tenant blast radius).

### 12.3 Runtime topology

The runtime is split into two execution domains connected by bounded channels:

```text
                    +---------------------------+
                    | Tokio control/service RT  |
                    | - proxy HTTP              |
                    | - shape attach/remove     |
                    | - adapter mgmt            |
                    +------------+--------------+
                                 |
                  bounded mpsc   |   bounded mpsc
                                 v
                 +-------------------------------+
                 | Timely worker set (tenant)    |
                 | - shared query graph           |
                 | - map/filter/join/semiJoin    |
                 | - fanOutAttach/Explode         |
                 | - frontier/progress            |
                 +---------------+---------------+
                                 |
                         sink batches/deltas
                                 v
                       Durable Streams append

Postgres side:
- replication connection -> Tokio ingest task -> Timely ingress
- snapshot/query-back pool -> Tokio upquery task -> Timely ingress (response rows)
```

This keeps high-throughput dataflow scheduling and progress semantics in Timely while leaving network/database I/O in Tokio.

#### 12.3.1 Operator dual-channel model

Inside the Timely worker, each operator participates in two communication planes:

**Forward plane (Timely-native).** Standard Timely input/output handles carry `Row`, `UpQueryComplete`, and `Frontier` messages. Timely manages buffering, exchange, and progress tracking for this plane. Up-query response rows flow through this plane (tagged with `upquery_ids`), reusing the same graph edges and operator logic as live data.

**Backward plane (Tokio mpsc + Timely activators).** Each operator owns an up-query inbox (Tokio mpsc receiver) and holds sender handles to its parent operators' inboxes. When an operator posts an up-query to a parent's inbox, it also calls the parent's Timely `Activator` to ensure the parent is scheduled even if no forward data is pending.

```text
Within a Timely worker:

           Forward (Timely edges)                    Backward (Tokio mpsc)
           ===================>                      <====================

Source    ─── Timely edge ───>  Filter  ── edge ──>  Join  ── edge ──>  Sink
Controller                       │                    │                   │
   ↑                             │                    │                   │
   │ inbox <─── mpsc ───────── inbox  <── mpsc ──── inbox <── mpsc ──── │
   │                             │                    │
   │         activator ──────────┘  activator ────────┘
   │
   └── compiles predicate to SQL, issues query-back via Tokio snapshot pool
       response rows re-enter Timely at Source Controller ingress
```

The operator's `run()` method processes both planes:

1. Drain Timely input handles (forward data: live rows, up-query response rows).
2. Drain backward inbox (up-query requests from downstream).
3. For forward rows with `upquery_ids`: match against pending up-query state, process through normal operator logic, clear tracking, release capabilities.
4. For backward requests: augment predicate per operator type (Section 8.3.1), forward to parent inbox, activate parent.

#### 12.3.2 Frontier layers in the runtime

The two-layer frontier model (Section 2.7) maps to the runtime as follows:

- **Timely capabilities** (held per operator per time) implement the physical frontier. An operator with pending up-queries retains capabilities, preventing Timely's physical frontier from advancing. This is the coarse-grained layer — conservative across all scopes sharing an output port.

- **Per-scope logical frontiers** are tracked by Galvanic's engine layer as metadata alongside each operator. Each scope's logical frontier advances independently when upstream progress and scope-local up-query completion both allow it. The sink uses these per-scope frontiers for stability decisions (marking data as stable, emitting frontier signals to Durable Streams).

Because data flows immediately regardless of frontier state, the physical frontier being held back by one scope does not block data delivery for other scopes. It only delays their stability signal at the Timely level — the per-scope logical layer compensates by providing fine-grained stability independent of unrelated pending work.

### 12.4 State durability and recovery

#### 12.4.1 State classes and the multiset-internal model

Operator state falls into three classes:

| Class                  | Examples                                                                                    | Persistence                      |
| ---------------------- | ------------------------------------------------------------------------------------------- | -------------------------------- |
| **Control metadata**   | Shape catalog, compiled plans, graph attachments, stream bindings, recovery cursors         | Must persist                     |
| **Index/lookup state** | Join/semi-join key indexes, fanout reverse indexes, source controller overlap-dedup ledgers | Rebuilt from replay + up-queries |
| **Transient state**    | Mailbox contents, in-flight up-query waits, dedupe windows                                  | Not persisted                    |

A notable question is: who tracks what rows have been emitted to the output? If internal operators had to do this, each would need persistent state that is not recoverable from upstream replay — the upstream source has no knowledge of what was emitted downstream. This would require per-operator persistence at every stateful node.

**Decision: the graph uses multiset semantics internally; the sink is the sole authority on wire classification.**

The graph operates on multiset diffs (`+1`/`-1`) throughout. Source controllers convert WAL events into diffs (insert -> `+1`, delete -> `-1`, update -> `-1` old then `+1` new). Operators process and propagate these diffs without ever classifying them as inserts, updates, or deletes. This is the same model as differential dataflow and TanStack DB's IVM, and naturally extends to aggregates and other algebraic operators.

The **sink** converts these diffs to wire protocol operations using a per-shape output-state store:

- `row_multiset[(output_key, row_fingerprint)] -> count` (count is an integer multiplicity, may go up/down but must be non-negative after consolidation).
- `visible_row[output_key] -> row_fingerprint | none` (derived deterministically from positive-count rows for that key).

Classification is transition-based:

- `none -> row` => `insert`
- `row_a -> row_b` (`row_a != row_b`) => `update`
- `row -> none` => `delete`
- `row -> row` (same fingerprint) => no wire-op (state-only change)

This transition model avoids key-presence ambiguity and remains correct even when joins or multiplicities produce more than one contributing row per output key.

This means no internal operator needs persistent output-tracking state. All internal state (indexes, dedup sets) is session-local and rebuildable. On restart, source controller state (overlap-dedup ledgers) resets cleanly — operators warm up incrementally via up-queries and the source controller re-learns overlap in the new session. Sink output-state persistence is release-scoped: V1 keeps it in-memory only; V2 persists per-shape output state at the sink.

#### 12.4.2 Sink output store

The sink output state store is release-scoped:

- **V1:** in-memory per-shape output state (`row_multiset` + derived `visible_row`) (not crash-durable).
- **V2:** durable local store shared across all shapes for a tenant, with each shape as a logical partition. The store must survive restarts, support efficient per-key transition evaluation, and be cleaned up when a shape is removed.
  - **Default path:** SQLite-backed output state for moderate cardinality and simpler operations.
  - **High-cardinality path:** LSM KV backend (RocksDB-class) when output-state churn/size exceeds SQLite performance envelopes.

**Crash-safe ordering and atomicity (V2 requirement):**

For each sink batch, persist in one local transaction:

1. output-state mutation (`row_multiset` / `visible_row` changes), and
2. durable append intent (outbox record with stable `Producer-Id/Epoch/Seq`).

Only after that transaction commits may the process attempt the external Durable Streams append.

On restart, replay pending outbox records with their stable producer tuple. Because output-state and outbox intent were atomically committed, classification and retry behavior are deterministic and do not emit duplicate inserts.

#### 12.4.3 Index/lookup state recovery

Index/lookup state (join indexes, fanout reverse indexes, etc.) is inherently rebuildable and does not require persistence.

**V1 and V2:** Rebuild by replaying source changes from the recovery cursor. As operators process replayed deltas, they issue up-queries on demand when they encounter missing state. Indexes fill incrementally — no bulk snapshot phase. The tradeoff is elevated up-query traffic during warm-up, which tapers as indexes fill.

**V3 candidates** (if replay recovery time exceeds SLO):

- Periodic operator-state checkpoints at frontier-aligned points, with tail-delta replay on restart.
- Incremental state logging with periodic compaction.

#### 12.4.4 Memory management

- **V1/V2:** Memory-only index state with per-operator and per-tenant budgets. Cold state is evicted and recovered via up-query on demand.
- **V3 candidate:** Local disk spill backend — hot pages in memory, cold pages on disk. Useful for high-cardinality joins where up-query churn from eviction becomes too expensive.

**Eviction policy (V1):**

- **Algorithm:** Weighted LRU per stateful operator (join indexes, semi-join indexes, fanout reverse indexes). Each entry is timestamped on access; eviction selects the least-recently-used entries when the operator's memory budget is exceeded.
- **Budget enforcement:** Each operator has a soft memory budget (configurable, default derived from per-tenant total budget divided by operator count). Eviction runs when the operator's state exceeds the soft budget. A hard per-tenant ceiling triggers emergency eviction across all operators for that tenant.
- **Eviction granularity:** Eviction is per-key (a join index entry for a specific join key, a reverse index entry for a specific guard value). Evicting a key means the operator will issue an up-query on the next miss for that key — the data is recoverable, not lost.

**Eviction storm safeguards:**

- **Up-query rate limiter.** Eviction-driven up-queries are subject to the same `max_inflight_upqueries_per_scope` limit as other up-queries. If the limit is reached, further eviction-triggered misses are queued rather than immediately generating up-queries. This bounds the burst load on the snapshot connection pool.
- **Eviction cooldown.** After an eviction pass on an operator, a configurable cooldown (`eviction_cooldown_ms`, default 100ms) prevents re-eviction of entries that were just filled by up-query responses. This breaks the cycle where eviction causes up-queries that fill state that immediately gets evicted again.
- **Admission filter.** When an up-query response fills an evicted key, the entry is marked with an admission timestamp. Entries younger than `eviction_min_age_ms` (default 10s) are skipped by the LRU eviction scan, ensuring recently-fetched data is not immediately re-evicted.
- **Backpressure signal.** If the eviction rate for an operator exceeds a configurable threshold (`eviction_rate_warn_per_sec`), the engine emits a telemetry warning. Persistent high eviction rates indicate the operator's budget is too small for the working set, and the operator should be monitored for performance degradation.

#### 12.4.5 V1 vs V2 recovery contracts

**V1:** No crash-resume guarantee. On crash, rebuild everything from scratch with new stream IDs. Sink output stores for old streams are discarded. Simple and correct, but clients must re-sync.

**V2:** Resume same streams without duplicates. Persist recovery cursor, producer session state (`Producer-Id`/`Epoch`/`Seq`), and pending append outbox. Sink output-state stores survive restart. On restart:

```text
load control metadata + producer session + pending outbox
    |
    v
open sink output stores (already durable from normal operation)
    |
    v
rebuild graph topology (index/lookup state empty;
                         sinks have their persisted output state)
    |
    v
resume ingest from persisted recovery cursor
    |
    +--> deltas flow through operators with empty indexes
    |      - source controllers convert WAL to multiset diffs (+1/-1)
    |      - operators hit misses, issue up-queries on demand
    |      - indexes fill incrementally (no bulk snapshot)
    |      - sinks classify diffs against their persisted output state
    |
    +--> resend pending outbox appends with stable producer tuple
    |
    v
sink appends via Producer-Id/Epoch/Seq → frontiers re-established
```

Outputs do **not** request initial snapshots on restart — the durable stream already has the data and clients can keep reading throughout. If no new data arrives for a table, its operators' indexes stay empty, which is harmless: there is nothing to process and the existing output is correct.

#### 12.4.6 Persistence backend strategy (V2+)

Use storage by **state class**, not one backend for all state:

- **Control/recovery metadata:** SQLite (WAL mode), including shape catalog, stream bindings, recovery cursors, producer session state, and pending append outbox.
- **Sink output state store:** SQLite by default; move to RocksDB-class KV when cardinality/churn justifies it.
- **Operator index/lookup state:** memory in V1/V2 (replay + up-query rebuild), optional disk spill in V3.

Rationale:

- SQLite provides transactional correctness, easy schema migration, and operational simplicity for control-plane metadata.
- RocksDB-class KV provides better write amplification and membership-check behavior at very large key-set scale.

**Flat files:** acceptable for debug exports/snapshots only, not as the primary crash-consistent store for control metadata or sink output state.

### 12.5 Global deduplication

- Input dedupe window: configurable, default 5ms.
- No `fanOutAttach`-specific time-window dedupe in V1.

---

## 13. Correctness and performance invariants

### 13.1 Correctness invariants (required)

These safety invariants are required for partial-state correctness:

- **At-most-once reflection:** each source change is reflected in readable outputs at most once.
- **No skipped predecessors on-path:** if a read observes effects of change `c`, it must also observe effects of earlier changes on the same complete dataflow path.
- **Safe drop on miss:** if a delta is dropped/deferred due to missing state at an operator, any downstream state that could be made stale by that drop must be evicted first.
- **Up-query completeness at merges:** union/shard-merger nodes emit up-query output only after all required response pieces for the response group/key are assembled.
- **Dependent up-query closure:** up-query responses that hit holes must complete dependent fills + redo before exposing downstream up-query effects.

### 13.2 Performance invariants

These are the performance properties the system must maintain at all times:

- **No unbounded buffering** waiting for snapshot completion — rows flow immediately.
- **Fanout explosion only when required** — `fanOutExplode` is placed as late as possible.
- **Column-demand pruning always on** — operators never receive fields they don't need.
- **Backpressure is explicit** on branch queues and sink appends — no silent drops or unbounded queues.

### 13.3 Required telemetry

The following metrics must be collected for operational visibility:

- Up-query in-flight count, latency, and failure rate.
- Operator queue depth and processing lag.
- Frontier lag per source and per sink.
- Time-without-frontier per sink (provisional duration).
- Operator state bytes (hot/in-memory) by operator type.
- Eviction count and up-query-after-eviction rate.
- Restart recovery time and replay catch-up throughput.
- Fanout attach set sizes and explode rates.
- Demux branch counts and spill-to-generic rate (when demux is enabled).
- Consolidate input/output ratios.
- Durable Stream append retry/dedupe counts.
- Spill hit/miss/read-latency (when spill is enabled).
- Up-query response assembly queue depth / wait time by response group.
- Dependent up-query hole counts, redo attempts, and redo latency.
- Incongruent-join eviction rate by operator/path.

---

## 14. Release scope

### 14.1 V1 — committed scope

- Shared graph with deduplicated operator reuse.
- Operators: map, filter, project, join, semi-join, fanout, consolidate, output.
- Multiset-internal model (`+1`/`-1` diffs throughout the graph); sink output-state store (in-memory, discarded on crash) for transition-based insert/update/delete classification on the wire protocol.
- Up-query protocol and snapshot-as-upquery.
- Join query-back-side planning + dependent up-query redo protocol + union/shard up-query response assembly.
- Postgres adapter first.
- Durable Stream sink with idempotent producer writes.
- Generic branch + strict fairness, with optional demux branch cap path.
- Delete/recreate reassignment flow.
- Memory budgets with evict-to-upquery (no disk spill).
- No crash-resume continuation guarantee; crash recovery is full rebuild + protocol re-resolution.

### 14.2 V2 — committed scope (next)

- Resumable crash recovery with no-duplicate continuation on same streams.
- Persisted recovery cursor + producer session state + pending outbox intents.
- Sink output-state stores survive restart — correct insert/update/delete classification from persisted per-shape output state (Section 12.4.1–12.4.2).
- Persistence backend split by state class: SQLite for control/recovery metadata and outbox; sink output state defaults to SQLite with RocksDB-class backend as scale path.
- CDC replay + up-query refill of index/lookup state on restart from persisted cursor; internal operators use multiset diffs, sink classifies against persisted output state.
- Compatibility tests for fencing/sequence-gap/retry flows against Durable Streams semantics.

### 14.3 V3 — candidates

- Aggregate operators.
- Full boolean factoring/routing for mixed `OR`.
- Cost-based join ordering to minimize up-query fan-out and state size (Section 6.4).
- Adaptive branch specialization and migration.
- Richer ordered/ranged up-queries.
- Deeper multi-dimensional version exploitation for recursive pipelines.
- Optional local spill backend for selected stateful operators.
- Optional incremental operator-state checkpointing for faster warm restart.
- In-place schema migration (DDL changes without full shape rebuild).

---

## 15. Delivery plan

### Phase 0: Scaffolding and contracts

- Define core traits/interfaces for adapter, compiler, engine, and sink.
- Define version/frontier abstractions and message envelopes.
- Define state-backend interface (`StateBackend`) with memory backend default.
- Establish test harness for deterministic replay.

### Phase 1: Core execution path

- Implement scalar-version execution with frontier propagation.
- Implement map, filter, project, join, semi-join operators.
- Implement up-query request/complete path and failure propagation.
- Implement dependent hole tracking + up-query redo scheduling in joins.
- Implement union/shard-merger up-query response piece assembly and group-key buffering.

### Phase 2: Fanout and sink integration

- Implement reverse-index-backed `fanOutAttach`.
- Implement optional `demuxByPlan` path with branch cap and generic overflow.
- Implement `fanOutExplode`.
- Implement sink output-state store (in-memory for V1) for transition-based multiset-to-insert/update/delete classification.
- Wire consolidate and Durable Stream writes with idempotent producer headers.
- Enforce memory budgets and eviction policy (evict-to-upquery).

### Phase 3: Compiler and optimizer depth

- Implement canonical IR → operator IR → physical IR lowering.
- Add guard extraction and recipient-dependency analysis.
- Enforce column-demand and explode-late rules.

### Phase 4: Protocol compatibility and hardening

- Align proxy behavior with current shape protocol and redirect semantics.
- Validate stale-handle and recreate flows.
- Implement DDL/schema-change handling: relation message detection, shape invalidation, lazy rebuild (Section 11.5).
- Run scale and chaos tests for up-query failures and branch overflow.

### Phase 5 (V2): Resumability and persistence

- Implement `RecoveryCursorStore` and producer-session persistence.
- Make sink output-state store persistent (durable across restarts for correct insert/update/delete classification on resume).
- Implement durable pending-append outbox with retry-on-restart.
- Validate no-duplicate crash/restart continuation using Durable Streams idempotent producer semantics.

### Phase 6 (V3): Advanced state acceleration and query depth

- Optional local spill backend and selective operator checkpoints.
- Aggregate operators and richer optimizer/routing pipeline.

---

## 16. Proposed Rust stack (V1)

### Execution and async runtime

- `tokio` — service runtime, timers, sockets, async orchestration.
- `timely` — core dataflow execution and progress tracking.
- `futures` / `tokio-stream` — async stream composition.

### Database ingress/query-back

- `tokio-postgres` — query-back/up-query SQL reads.
- Postgres logical replication client:
  - **Preferred:** `pgwire-replication` + Galvanic-owned pgoutput decoder behind `IngestAdapter` trait.
  - **Alternate:** `pg_walstream` when faster delivery outweighs dependency/control tradeoff.
  - **Fallback:** internal protocol implementation over `postgres-protocol` if crate gaps appear.

### Compiler/IR/parsing

- Canonical IR owned by Galvanic crate(s).
- `pg_query` — Postgres-compatible parsing frontend.
- `sqlparser` — optional portable SQL frontend.

### Graph/state/data structures

- `petgraph` — control-plane graph structures.
- `smallvec` — small recipient sets.
- `roaring` — promoted recipient bitmaps.
- `indexmap` — deterministic iteration in planning/debuggability.
- `StateBackend` abstraction (memory backend in V1; optional local-disk backend in V3).

### Persistence backends (V2+)

- `sqlite` (`rusqlite` or async wrapper) — control metadata, recovery cursor store, producer session state, pending append outbox.
- Sink output-state backend behind trait:
  - default SQLite implementation for moderate workloads,
  - RocksDB-class implementation for high-cardinality/high-churn output state.

### Service surface and control plane

- `axum` + `hyper` + `tower` — proxy/control APIs.
- `serde` / `serde_json` — protocol and config payloads.

### Observability and ops

- `tracing` + `tracing-subscriber` — structured logs.
- `metrics` + Prometheus exporter — counters/histograms/gauges.
- Optional OTel bridge if required by deployment.

---

## 17. Risks and mitigations

| Risk                                                                                                          | Mitigation                                                                                                              |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Up-query storms under high miss rates                                                                         | Routing-scope-limited up-queries, branch caps, inflight limits, backpressure, failure fast-path                         |
| Incorrect ordering between live changes and query-back responses                                              | Adapter-level barrier/version rules and explicit frontier semantics                                                     |
| Fanout explosion from premature explode placement                                                             | Optimizer explode-late invariant + telemetry guardrails                                                                 |
| Complexity drift in optimizer                                                                                 | V1 baseline correctness path always available (`AND` split only); feature-flag advanced rewrites                        |
| Protocol regressions for handle rotation and cache behavior                                                   | Compatibility tests against current Electric protocol behavior                                                          |
| V1 crash causes stream/session reset instead of seamless continuation                                         | Make this explicit in V1 contract; prioritize V2 resumability immediately after V1 baseline                             |
| No-duplicate continuation depends on correct Durable Streams idempotent semantics + producer state durability | Protocol-level conformance tests for `Producer-Id`/`Epoch`/`Seq`, fencing, sequence-gap handling, and crash retry paths |

### Complexity Check

- **Is this the simplest approach?** The up-query/partial-state model adds complexity vs. a "pre-load everything" approach, but pre-loading does not scale to 100k+ shapes with large datasets. Partial state is the minimum viable approach for the scale target. Timely Dataflow adds framework weight, but provides multi-core scheduling and progress tracking that would otherwise need to be built from scratch.

- **What could we cut?** If we had half the time: drop `demuxByPlan` branching (already optional/off by default), drop subquery-pushdown mode for up-queries (use key-list only), defer semi-join as a distinct operator (implement via inner join + project), and skip the plan-signature trie (use linear scan for operator reuse). These simplifications trade scale ceiling and optimizer quality for faster delivery.

- **What's the 90/10 solution?** Single-table shapes with filter predicates and reverse-index fanout — no joins, no subqueries. This is what the current Electric already does. The 90/10 of this RFC is adding inner joins + semi-joins to that baseline, which unlocks the `WHERE x IN (subquery)` pattern that is the most requested expressiveness improvement.

---

## 18. Gap closure from current Electric architecture

> This section details the specific architectural constraints referenced in the Problem statement above. Each subsection describes a current limitation and the corresponding Galvanic V1 requirement.

### 18.1 Non-blocking fanout dispatch is mandatory

**Current problem:** The current Electric routes replication fragments synchronously to all affected shape consumers. One slow or blocked consumer can stall global ingest progress (head-of-line blocking).

**Galvanic requirement:**

- The ingest/route path must never synchronously wait on per-shape/operator processing completion.
- Per-operator mailboxes must be bounded, with explicit overload policy (backpressure, fail-fast, or shape invalidation).
- Frontier advancement must be decoupled from single-recipient latency outliers.

### 18.2 Subquery capability boundary must be compiler-enforced

**Current problem:** The current Electric supports useful `IN (subquery)` paths but still falls back to runtime invalidation for specific boolean forms and multi-subquery cases.

**Galvanic requirement:**

- Define the V1 accepted query subset at compile time (semi-join focused).
- Reject unsupported patterns at compile time with explicit error codes.
- Avoid runtime "invalidate shape and refetch" as normal control flow for unsupported logic.

### 18.3 Snapshot/live interleaving contract must be formalized

**Current problem:** The current Electric has explicit buffering/filtering state around initial snapshot correctness. Galvanic chooses minimal buffering and "no frontier yet == provisional," which is valid only with clear downstream invariants.

**Galvanic requirement:**

- Every emitted row must carry a comparable source version.
- Sink `consolidate` must be version-aware and idempotent over out-of-order arrival between live and up-query rows.
- Frontier emission must remain blocked until snapshot/up-query completion guarantees are satisfied for that shape output.

### 18.4 "Return all shapes on filter error" fallback must not exist

**Current problem:** The current Electric uses a correctness-safe but high-blast-radius fallback when filter/index evaluation fails unexpectedly — it fans out to all shapes.

**Galvanic requirement:**

- Scope failures to the smallest graph region possible (operator/shape-level).
- Never convert a local filter error into global fanout amplification.
- Include explicit operator health/error channels and fast isolation/removal behavior.

### 18.5 HTTP/proxy compatibility must preserve cache/chunk semantics

**Current problem:** The current Electric behavior depends heavily on chunk-aware offsets, ETag behavior, and stale-handle redirect semantics.

**Galvanic requirement:**

- Preserve `offset=-1`, `handle`, 409 must-refetch semantics.
- Preserve chunk boundary semantics for cache efficiency.
- Make the Durable Stream read API expose stable chunk/etag boundaries expected by proxy/CDN.

### 18.6 Shape scale target implies no process-per-shape runtime model

**Current problem:** The current Electric uses per-shape consumer/materializer process patterns that are effective at current scale but do not match million-shape targets.

**Galvanic requirement:**

- Shared graph operators must be multiplexed over many shapes.
- Shape attachment should be metadata and index updates, not process spawning.
- Reference counting and GC remain shape-aware, while execution remains operator-centric.

---

## 19 Open Questions

| Question                                                                                                                            | Options                                                       | Resolution Path                                          |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------- |
| **Per-tenant resource limits** — What are the initial defaults for max in-flight up-queries, queue depth, and branch cap overrides? | Conservative defaults with per-tenant override                | Determine during Phase 1 benchmarking                    |
| **Sealed stream retention** — What is the exact Durable Stream retention window for rotated/sealed stream IDs?                      | 24h default (Section 10.4) vs. shorter/longer                 | Decide based on CDN cache TTL requirements               |
| **Second database adapter** — Which adapter after Postgres?                                                                         | MySQL vs. MongoDB                                             | Decide based on customer demand after V1 launch          |
| **V1 crash contract** — Do we accept full rebuild + stream re-resolution as the V1 crash behavior?                                  | Yes (current proposal) vs. invest in partial recovery earlier | Team decision; V2 resumability should have a date target |
| **V2 recovery SLO** — What p95 recover-to-frontier time do we commit to?                                                            | Depends on target tenant size and index rebuild cost          | Prototype during V1 to gather recovery-time data         |
| **Timely worker count** — How many Timely workers per tenant?                                                                       | 1 per core vs. fixed count vs. auto-scaled                    | Benchmark during Phase 1                                 |

---

## 20 Definition of Success

### 20.1 Primary Hypothesis

> We believe that replacing the Elixir sync core with Galvanic (a Rust dataflow engine with shared-graph operators, up-queries, and multiset semantics) will enable ElectricSQL to support joins/subqueries natively and scale to 100k+ concurrent live shapes per tenant.
>
> We'll know we're right if: (1) a shape with `WHERE x IN (subquery)` works correctly end-to-end with live maintenance, (2) a single tenant sustains 100k active shapes with sub-100ms p99 change-to-client latency on a realistic workload, and (3) the Postgres adapter passes all existing Electric protocol compatibility tests.
>
> We'll know we're wrong if: up-query storms under realistic workloads cause sustained snapshot pool exhaustion, or Timely's scheduling overhead dominates the latency budget, making the system slower than the current Elixir implementation for simple single-table shapes.

### 20.2 Functional Requirements

| Requirement                        | Acceptance Criteria                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| Single-table shape with filter     | Equivalent behavior to current Electric: correct initial snapshot, live updates, handle rotation |
| Shape with `WHERE x IN (subquery)` | Correct initial snapshot via up-query, correct live maintenance when either table changes        |
| Shape with inner join              | Correct join output, correct retraction on delete from either side                               |
| Sparse fanout at 100k shapes       | No global stall; change-to-client p99 < 100ms for a change affecting 1 shape                     |
| DDL schema change                  | Affected shapes invalidated, clients receive 409, re-subscribe works                             |
| Crash recovery (V1)                | Full rebuild completes, new stream IDs issued, clients re-sync successfully                      |

### 20.3 Learning Goals

1. Is the Timely capability/activator model sufficient for up-query integration, or will we need a custom scheduler?
2. What is the steady-state memory footprint per shape for join-based shapes, and does the eviction policy keep it bounded?
3. What is the up-query latency distribution under realistic join workloads, and does it meet the latency budget?

## 21 Alternatives Considered

### 21.1 Alternative 1: Differential Dataflow as the engine substrate

**Description:** Use Differential Dataflow directly (not just Timely) for the engine. Differential provides high-level incremental operators (arrangements, joins, reduce) with built-in compaction and state management.

**Why not:** Galvanic's core mechanic is partial state with on-demand up-queries. Differential's operators assume full state — they maintain complete arrangements and do not support "missing entries filled on demand." Adapting Differential's operator internals to support partial state would require deep modifications to the framework. Using Timely directly and building custom operators gives us the control we need without fighting the abstraction.

### 21.2 Alternative 2: DBSP / Feldera-style pure incremental pipeline

**Description:** Model the entire engine as a DBSP circuit using the formal incrementalization algorithm (Algorithm 4.6 from the DBSP paper). Each operator is its incremental version; state is maintained via integration operators (I).

**Why not:** DBSP assumes full state at integration points — every `I` operator accumulates the entire history. This is correct but does not support the partial-state/eviction model needed for 100k+ shapes where not all data fits in memory. DBSP's formal framework informs our multiset semantics and consolidation design, but the execution model needs the partial-state extension that Noria's up-queries provide.

### 21.3 Alternative 3: Extend the current Elixir implementation

**Description:** Add joins, subqueries, and improved fanout to the existing Elixir sync service incrementally.

**Why not:** The Elixir runtime does not provide the low-level memory control, scheduling precision, or data structure efficiency needed for the target scale. The per-shape process model does not scale to 100k+ shapes. A rewrite in Rust with a fundamentally different execution model (shared graph, not per-shape processes) is required.

## 22 References

- [Noria thesis (primary)](https://pdos.csail.mit.edu/papers/jfrg:thesis.pdf)
- [Noria thesis (alternate mirror)](https://jon.thesquareplanet.com/papers/phd-thesis.pdf)
- [Noria codebase](https://github.com/mit-pdos/noria)
- [Timely Dataflow docs (progress/frontiers)](https://timelydataflow.github.io/timely-dataflow/)
- [Differential Dataflow docs (arrangements/compaction)](https://timelydataflow.github.io/differential-dataflow/)
- [DBSP paper (VLDB 2023)](https://www.vldb.org/pvldb/vol16/p1601-budiu.pdf)
- [Differential Dataflow (CIDR 2013)](https://www.cidrdb.org/cidr2013/Papers/CIDR13_Paper111.pdf)
- [Materialize: Differential from Scratch](https://materialize.com/blog/differential-from-scratch/)
- [Feldera docs (incremental SQL pipelines)](https://docs.feldera.com/)
- [Materialize docs (incremental materialized views)](https://materialize.com/docs/sql/create-materialized-view/)
- [`pgwire-replication` crate](https://crates.io/crates/pgwire-replication)
- [`pg_walstream` crate](https://crates.io/crates/pg_walstream)
- Durable Streams protocol (idempotent producer semantics): `durable-streams/PROTOCOL.md`
- TanStack DB IR/compiler references:
  - `db/packages/db/src/query/ir.ts`
  - `db/packages/db/src/query/optimizer.ts`
  - `db/packages/db/src/query/compiler/index.ts`
  - `db/packages/db-ivm/src/multiset.ts`
  - `db/packages/db-ivm/src/operators/consolidate.ts`

## 23 Revision History

| Version | Date       | Author    | Changes                                                                                                                                                                                                                                                  |
| ------- | ---------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0     | 2026-03-04 | samwillis | Initial draft                                                                                                                                                                                                                                            |
| 1.1     | 2026-03-05 | samwillis | Added Timely integration details (Sections 2.6-2.7, 8.3.0, 12.3.1-12.3.2), eviction policy, operator reuse algorithm, DDL handling, Durable Streams interface, consolidation semantics, REPLICA IDENTITY FULL requirement. Restructured to RFC template. |

---

## 24 RFC Quality Checklist

**Alignment**

- [x] RFC addresses the core product need (real-time sync with joins/subqueries at scale)
- [x] API naming matches ElectricSQL conventions (shape protocol, handle rotation, offset semantics preserved)
- [x] Success criteria link back to primary hypothesis

**Calibration**

- [x] This is the simplest approach that supports joins + 100k shapes (Complexity Check filled out)
- [x] Non-goals explicitly defer aggregates, outer joins, boolean factoring, crash-resume to V2/V3
- [x] An engineer could start implementing Phase 0 tomorrow

**Completeness**

- [x] Happy path is clear (Sections 7.2.2, 8.3.3 provide end-to-end examples)
- [x] Critical failure modes addressed (up-query failure, eviction storms, DDL, crash recovery)
- [x] Open questions acknowledged with resolution paths
