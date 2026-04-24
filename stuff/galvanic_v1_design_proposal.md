# Galvanic V1 Design Proposal

Status: Draft for team review  
Date: 2026-03-04  
Project codename: Galvanic

## 0. At-a-glance plan

### 0.1 What we are building

Galvanic V1 is a **Rust-based** sync-query platform that replaces the current Elixir sync core with a pluggable dataflow engine.

Core architecture:

1. `ingest` (database CDC + query-back adapters)
2. `compiler` (shape/query -> canonical IR -> physical plan)
3. `engine` (shared graph, incremental operators, up-queries, fanout)
4. `durable streams` (result persistence and delivery substrate)
5. `proxy` (shape protocol, cache semantics, stream resolution)

### 0.2 Runtime and language decisions

- implementation language: `Rust`
- async/service runtime: `Tokio`
- dataflow execution substrate: `Timely` workers with Galvanic-owned operators
- storage ownership: moved out of engine into Durable Streams

### 0.3 Delivery plan (V1)

1. Foundation: traits/contracts, version/frontier model, deterministic replay harness.
2. Core engine: map/filter/project/join/semi-join + up-query protocol.
3. Scale path: reverse-index fanout (`fanOutAttach`/`fanOutExplode`) + sink exactly-once writes.
4. Compatibility/hardening: current Electric protocol parity (`offset=-1`, handle rotation, 409 refetch), scale + chaos testing.

### 0.4 Success criteria

- sparse fanout to very large live shape counts without global stalls
- richer query expressiveness than current single-table fast path
- pluggable DB adapters with engine core not tied to Postgres internals
- no additional internal latency beyond explicit DB query-back cost

### 0.5 One-page architecture diagram (ASCII)

```text
                         (shape requests / live reads)
+-----------+      HTTP      +-------------------+      read/write      +----------------------+
| Browser / | <------------> |  Galvanic Proxy   | <------------------> |   Durable Streams    |
| SDK Client|                | (protocol/cache)  |                       | (append + tail/read) |
+-----------+                +---------+---------+                       +-----------+----------+
                                        |                                             ^
                                        | cache miss / shape attach                   |
                                        v                                             |
                  +---------------------+---------------------------------------------+---+
                  |             Galvanic Server (Rust: Tokio + Timely)                   |
                  |                                                                       |
                  |   +-----------+      +------------+      +------------------------+  |
CDC + query-back  |   |  ingest   | ---> |  compiler  | ---> |  engine (shared graph) |--+
adapters          |   | (adapter) |      | (IR/plan)  |      | map/filter/join/fanout |
                  |   +-----+-----+      +-----+------+      +-----------+------------+  |
                  +---------|-------------------|--------------------------|---------------+
                            |                   |                          |
                            v                   |                          |
                    +---------------+           |                          |
                    | Postgres WAL  | <---------+------ up-query SQL ------+
                    | / other CDC   |
                    +---------------+
```

## 1. Executive summary

Galvanic is a new **Rust** sync-query engine intended to replace the current Elixir-centric sync core with a lower-level, pluggable, dataflow-driven architecture.

The V1 architecture is:

1. `ingest` (database CDC + query-back adapter)
2. `compiler` (shape/query definition -> IR -> physical plan)
3. `engine` (shared query graph, incremental execution, up-queries, fanout)
4. `durable streams` (result log and delivery substrate)
5. `proxy` (shape protocol entrypoint, stream resolution, caching semantics)

Key decisions captured here:

- full rows inside the graph in V1
- non-JSON internal row envelope with lazy column decoding
- first-class `fanOut` operator with attach/explode forms
- `demuxByPlan` as optional physical optimization (default off)
- shared graph with deduplicated operators and refcount GC
- up-query/snapshot modeled as the same mechanism
- no aggregate support in V1
- subqueries in `WHERE ... IN (...)` implemented as semi-joins
- no buffering for provisional state; rely on frontier semantics
- exactly-once sink writes via durable-stream idempotent producer headers
- pluggable core with database adapters and database-specific IR extensions

## 2. Why we are doing this

### 2.1 Current constraints

- The current sync service optimized single-table shape fanout very well, but complex query expressiveness is bolted on.
- Elixir has not provided the low-level control/perf envelope desired for the next stage.
- Storage is being split out into Durable Streams; the sync engine should stop owning storage internals.
- Future targets include massive sparse fanout (100k to millions of live queries) and richer joins/subqueries.

### 2.2 Design goals

- Keep the major fanout performance win (reverse-index-driven sparse fanout).
- Introduce a query framework that naturally supports expressive predicates and joins.
- Preserve low internal latency (DB round-trips are acceptable; avoid added internal stalls).
- Keep core engine database-agnostic and pluggable (Postgres, MySQL, MongoDB, etc.).
- Support dynamic shape add/remove without stopping the server.

### 2.3 Non-goals for V1

- Full aggregate support (deferred).
- Full boolean factoring/routing optimizer.
- Live branch migration/rebalancing between generic and dedicated demux branches.

## 3. External research and implications

### 3.1 Noria thesis implications

The thesis on partial state and upqueries gives directly relevant patterns:

- Upqueries are explicit mechanisms to fill missing state on demand in dataflow.
- Correctness under partial state requires explicit invariants for races between deltas and upquery responses.
- Upquery explosion under sharding mismatch is a real risk (`k^2` style amplification) and needs explicit control.
- Recovery by operator/descendant re-introduction is a viable baseline strategy.

Applied to Galvanic:

- We keep up-queries explicit in protocol and operator contracts.
- We avoid unconstrained fanout/shard expansion by attach/explode separation and branch caps.
- We treat recovery and graph rebuild as first-class operations, not edge cases.

### 3.2 Noria codebase findings (repo inspection)

Inspection target: https://github.com/mit-pdos/noria

Directly relevant implementation details:

- SQL path is parser -> query graph -> MIR -> flow graph (`nom-sql` frontend).
- Execution is organized into single-threaded domain tasks on Tokio worker pools.
- Up-query/replay is an explicit packet path (`ReplayPiece`, replay setup paths, trigger endpoints).
- Partial replay has explicit deadlock risk if replay concurrency is below replay fan-in width.
- Replay source selection is key-shard/same-shard/all-shards, and all-shards paths are carefully constrained.
- Replay batching timeout exists to coalesce key requests before issuing replays.
- Union/shard-merger operators buffer replay pieces until all required parents arrive, then release.

Implications for Galvanic:

- We need a hard invariant: `max_inflight_upqueries_per_scope >= max_upquery_fan_in`.
- We need explicit source/routing scope on upqueries to avoid all-shards amplification.
- We should dedupe in-flight upqueries by `(operator, predicate/key, version-bucket)`.
- We should keep bounded replay key batching (`input_dedupe_window_ms`, default `5ms`).
- We should keep `fanOutAttach`/`fanOutExplode` split to avoid premature explosion.

### 3.3 Timely vs Differential

Timely provides:

- strong progress/frontier model
- robust multi-core execution substrate
- scheduling and communication primitives for dataflow graphs

Differential provides:

- powerful high-level incremental operators over maintained traces/arrangements
- excellent for heavy shared maintained state

Galvanic-specific constraint:

- Up-queries and "missing state + request upstream now" are core semantics.
- We likely cannot use differential's standard stateful operators as-is for this model.

Decision for V1:

- Use Timely-style execution/runtime foundations.
- Build custom up-query-aware stateful operators on top.
- Keep differential-inspired algebra/optimization patterns where useful (consolidation, arrangement-like indexing, semijoin structure), but do not couple V1 correctness to differential operator internals.

## 4. High-level architecture

## 4.1 Logical deployment

1. `galvanic-ingest` library
2. `galvanic-compiler` library
3. `galvanic-engine` library
4. `durable-streams-server` service
5. `galvanic-proxy` service

`1/2/3` compose into a runtime server for a tenant-scoped upstream database.

## 4.2 Core dataflow shape

- Single shared query graph per tenant/upstream database.
- New shape definitions compile into candidate operator DAG fragments.
- Existing equivalent operators are reused (structural dedupe).
- Output sinks map graph results to durable streams.

## 4.3 Dynamic lifecycle

- Shapes can be added frequently without stopping execution.
- Operators are refcounted by downstream consumers.
- When refcount reaches zero, operator state is removed.
- Reassignment/migration is done by delete + lazy recreate, not live branch migration.

## 5. Protocol and message model

## 5.1 Downstream messages

`Row`

- fields: `row`, `old_row`, `op(insert|update|delete|fetch)`, `version`, `meta`
- `fetch` represents up-query/snapshot responses

`UpQueryComplete`

- fields: `upquery_id`, `version`

`Frontier`

- fields: `frontier_version`

## 5.2 Upstream messages

`UpQuery`

- fields: `upquery_id`, `source`, `predicate`, `requested_version`, `routing_scope`

Routing rule:

- Upqueries only propagate up branches that requested them.

## 5.3 Provisional/stable semantics

- No explicit provisional-row marker in V1.
- Snapshot and live rows both flow immediately.
- Stable state is indicated by frontier progression only.
- "No frontier yet" means "still provisional."

This intentionally avoids additional buffering/coordination complexity.

## 5.4 Message flow diagram (ASCII)

```text
Downstream data/control
-----------------------
ingest --> operators --> sink --> durable streams --> proxy --> client
           |              |
           |              +--> Frontier(version)
           +--> Row(op=insert|update|delete|fetch, version)
           +--> UpQueryComplete(id, version)

Upstream request/control
------------------------
operator needing state
    --> UpQuery(id, source, predicate, requested_version, routing_scope)
    --> adapter/query-back
    --> fetch rows (Row op=fetch, versioned)
    --> UpQueryComplete
```

## 6. Version model and progress

## 6.1 Core model

- V1 defaults to scalar source version for single-source pipelines (Postgres LSN for PG).
- Frontiers are propagated as lower bounds of future versions.
- Frontier publication is sink-local/output-local (not a single global frontier gate for all shapes).

## 6.2 Multi-dimensional compatibility

The internal version API is designed to support antichain/partially ordered versions so future recursion/iterative operators can use multi-dimensional versioning without rewriting the whole engine.

V1 can run single-dimension fast-paths while preserving this interface boundary.

## 6.3 Frontier and stability semantics (ASCII)

```
Version axis (scalar V1):   v100 ---- v101 ---- v102 ---- v103 ---->

Downstream rows:
  live row A@v101 -------------------------------> emit immediately
  snapshot row S@v102 (from UpQuery U1) --------> emit immediately

Control:
  UpQuery(U1, requested=v101) -------------------> adapter/query-back
  UpQueryComplete(U1, at=v102) ------------------> operator clears wait

Operator local state:
  pending_upqueries = {U1}  --(complete)--> {}

Frontier rule:
  emit Frontier(vX) only when:
  1) upstream progress allows vX, and
  2) pending_upqueries is empty for versions <= vX

Consequence:
  rows can flow before stability; "no frontier yet" is the provisional signal.
```

## 7. IR and compiler design

## 7.1 Why IR-first

To keep the query engine backend-agnostic:

- query definitions are compiled into an engine IR
- database-specific behavior lives in adapters and custom IR/operator extensions
- physical planning is separate from logical semantics

## 7.2 IR phases

### Phase A: Canonical logical IR (SQL-like)

Shape-level constructs:

- `from`, `join`, `where`, `select`, `order/limit` (where applicable), subqueries

This resembles TanStack DB's query IR structure and keeps user-level semantics explicit.

### Phase B: Normalized operator IR (algebraic)

Lower to operator vocabulary:

- `map`, `filter`, `project`, `join`, `semiJoin`, `fanOut`, `consolidate`, `output`

Attach annotations:

- required columns
- recipient dependency (`none|attached|exploded`)
- pushdown eligibility
- residual predicates

### Phase C: Physical graph IR

Adds:

- sharding/exchange placement
- `fanOutAttach`/`fanOutExplode` split
- optional `demuxByPlan` branch assignment
- branch caps and generic overflow branch routing

### 7.2.1 IR lowering pipeline (ASCII)

```
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
  - normalize aliases/expr
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

## 7.3 Optimizer passes (V1)

1. normalize expressions and aliases
2. lower `IN (subquery)` to semi-join form
3. split root `AND` predicates (baseline correctness path)
4. safe guard extraction (`P(row, recipient) => G(row)`) for pre-fanout pruning
5. conservative `OR` handling (mixed `OR` remains post-fanout in V1)
6. column-demand pruning across edges
7. fanout placement (`attach` early enough for reverse index, `explode` as late as possible)
8. physical branch planning with caps

### 7.4 Guard extraction policy

Adopted plan:

- V1 correctness baseline: `AND` split pushdown.
- V1 optimization: safe guard extraction for broader pruning.
- V2: full boolean factoring/routing.

## 7.5 Parser frontends and recommendation

Core rule:

- `galvanic-engine` consumes canonical logical IR only; it does not depend on any SQL parser.

Frontend/parsing options:

- Postgres-compat frontend: PostgreSQL parser (`pg_query`) for PG shape/filter compatibility.
- Portable SQL frontend: `sqlparser` for ANSI-ish multi-dialect support where exact PG behavior is not required.
- Non-SQL frontend: typed shape DSL/JSON -> canonical IR directly.

Recommendation:

- V1: keep Postgres parser compatibility in the Postgres adapter/frontend path to match current Electric behavior.
- V1: normalize immediately into canonical IR so downstream compiler/engine remain database-agnostic.
- V2: add optional portable frontend (`sqlparser`) for non-Postgres SQL-backed adapters.

## 7.6 Adapter capability gating

To keep the core engine portable without hidden Postgres coupling:

- every adapter exposes a `CapabilitySet` (e.g. scalar version order, before/after image quality, predicate pushdown classes, snapshot semantics)
- compiler validates IR against `CapabilitySet` before physical planning
- unsupported constructs fail at compile time with explicit error codes (no silent runtime fallback)
- database-specific functionality is introduced via declared IR extensions/custom operators, each bound to named capabilities

This enforces "portable-by-default, explicit-escape-hatch" behavior for MySQL/MongoDB and future adapters.

## 8. Operator model

## 8.1 Operator set (V1)

- stateless: `map`, `filter`, `project`
- stateful: `join`, `semiJoin`
- fanout: `fanOutAttach`, `fanOutExplode`
- physical exchange (optional): `demuxByPlan`
- output: `consolidate`, `sinkWrite`

No aggregate operator in V1.

## 8.2 Full-row policy

Decision:

- full rows are carried through graph operators in V1
- column pruning still applies to eliminate truly unused fields per edge, but operator contracts remain "row complete for this node"

Partial row output is handled at sink projection stage.

## 8.3 Fanout design

### 8.3.1 Why not N outputs per recipient

Per-recipient branch fanout causes topology and backpressure explosion at target scale.

### 8.3.2 Adopted design

`fanOutAttach`

- one logical output stream
- computes recipient set via reverse index
- does not explode rows

`demuxByPlan`

- optional bounded split by downstream plan hash
- default off in V1 for simplicity
- enable only when branch-level backpressure isolation is needed
- when enabled: small bounded `N` (default 64), overflow to generic branch

`fanOutExplode`

- materializes per-recipient rows only when a downstream op requires recipient-local evaluation

### 8.3.3 Recipient set representation

Hybrid container:

- `SmallVec` for small sets
- promote to `RoaringBitmap` for larger sets
- promotion threshold default `64`, configurable

### 8.3.4 Branch policy

- `demux_enabled = false` default, configurable
- `max_branches_per_fanout = 64` when demux enabled, configurable
- overflow shapes route to generic branch
- generic branch scheduling: strict fair (V1)
- no live branch promotion/demotion in V1
- reassignment path: delete shape graph state, lazy recreate on next request

### 8.3.5 Fanout placement diagram (ASCII)

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

## 9. Up-query model

## 9.1 Snapshot = up-query

Initial snapshots and runtime misses both use the same up-query mechanism.

Behavior:

- outputs request snapshot via up-query when needed
- once snapshot rows arrive, normal maintenance continues
- live rows are not held back waiting for snapshot

## 9.2 Operator wait tracking

- operators track in-flight `upquery_id`s they depend on
- state retention floor considers outstanding upqueries
- once matching `UpQueryComplete` arrives and relevant frontiers pass, state can GC

## 9.3 Failure behavior

Decision:

- if an up-query fails, fail operators waiting on it
- remove failed operators and dependent subgraph
- dependent shapes are invalidated and removed

## 9.4 Snapshot/live interleaving timeline (ASCII)

```text
time ---->

live Row(v=101) -------------------------> sink (provisional; no frontier yet)
live Row(v=102) -------------------------> sink (provisional; no frontier yet)
snapshot Row(fetch, v=98) --------------> sink (consolidate resolves ordering)
snapshot Row(fetch, v=100) -------------> sink
UpQueryComplete(id, v=103) -------------> operator/sink
Frontier(v=103) ------------------------> marks stable state through v=103
```

## 10. Ingest abstraction and database adapters

## 10.1 Adapter contract

Each adapter provides:

- change stream ingestion
- version extraction/comparison
- frontier production strategy
- up-query execution
- type mapping and key extraction

## 10.2 Postgres adapter specifics

- consumes logical replication stream (LSN ordered)
- emits source frontier from replication progress
- performs query-back with snapshot/barrier semantics described in `stuff/wal_lsn_query_back.md`
- V1 assumes full-row semantics for graph processing

Current Electric behavior requires `REPLICA IDENTITY FULL` for correct old/new row handling in the replication pipeline; Galvanic's adapter boundary should keep this as an adapter concern, not a core-engine assumption.

## 10.3 Other databases

MySQL/MongoDB adapters can vary in change-image fidelity and version semantics; the core engine only requires the adapter contract and version order guarantees, not Postgres-specific constructs.

## 10.4 Internal data representation (RowEnvelope)

### 10.4.1 Core decision

- JSON is an output/wire format, not the canonical internal row format.
- Engine operators consume row envelopes with raw cell payloads and lazily decode only accessed fields.

This keeps core execution database-agnostic and avoids repeated JSON encode/decode overhead in hot paths.

### 10.4.2 Envelope model (V1)

```rust
enum OpKind { Insert, Update, Delete, Fetch }

struct RowEnvelope<V> {
    relation_id: RelationId,
    op: OpKind,
    version: V,
    key: Option<KeyBytes>,
    before: Option<RowImageRef>,
    after: Option<RowImageRef>,
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
    UnchangedToast, // adapter-specific placeholder if needed
}
```

Notes:

- `raw` is immutable and shareable across operators.
- `decoded_cache` is per-row-image lazy cache keyed by column id.
- `before`/`after` images support update semantics without forcing eager merge/expansion.

### 10.4.2.1 RowEnvelope access flow (ASCII)

```
WAL / Query-back row
        |
        v
RowEnvelope {
  before/after -> RowImageRef(raw bytes + decoded_cache)
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

### 10.4.3 Operator-facing access contract

Operators access fields via accessor APIs, not by directly deserializing the entire row:

```rust
trait RowAccess {
    fn raw(&self, image: ImageKind, col: ColId) -> Option<&RawCellRef>;
    fn decoded<T: 'static>(&self, image: ImageKind, col: ColId, codec: &dyn Codec) -> Result<Option<&T>, DecodeError>;
}
```

Rules:

- stateless `map/filter/project` should request only referenced columns.
- `fanOutAttach` should primarily touch key/guard/index columns.
- `fanOutExplode` should preserve envelope sharing where possible and avoid deep copies.

### 10.4.4 JSON/JSONB handling

- JSON/JSONB columns are kept raw initially.
- decode is lazy at two levels:
  - column-level parse on first access
  - nested/path parse on first child access where practical

This matches the goal of not paying parse cost for unused nested fields.

### 10.4.5 Ingest/query-back implications

- WAL ingest already arrives as field tuples and maps cleanly into raw cells.
- Query-back should avoid building full JSON rows in SQL for engine-internal use.
- Postgres adapter should fetch typed row fields and build `RowEnvelope` directly.
- Sink/proxy path performs JSON encoding as the final step before durable-stream append/HTTP emission.

### 10.4.6 V1 rollout strategy

1. Introduce `RowEnvelope`/`RawCellRef` and keep operator behavior functionally equivalent.
2. Implement lazy decode cache and switch predicate/project/join accessors to on-demand decode.
3. Add metrics: decode calls, cache hit rate, bytes decoded per operator.
4. Keep optional compatibility mode for adapter/query-back JSON rows during migration, but default to non-JSON envelope mode.

## 11. Sink path and durable streams

## 11.1 Output pipeline

Result path:

1. project to output schema (supports partial-row emission semantics)
2. version-aware consolidate changes (must be idempotent under out-of-order live vs fetch arrival)
3. convert to insert/update/delete wire events
4. append to durable stream with idempotent producer headers

## 11.2 Exactly-once semantics

- Durable Streams idempotent-producer headers are used directly:
  - `Producer-Id`
  - `Producer-Epoch`
  - `Producer-Seq`
- server responses (`200/204`, `403` stale epoch fencing, `409` sequence gap with expected/received headers) drive producer recovery behavior.
- exactly-once dedupe at append boundary is delegated to Durable Streams protocol semantics.

Release-scoped guarantee:

- V1: exactly-once for in-process retry/replay-to-sink attempts; crash continuation to the same stream is not guaranteed.
- V2: exactly-once across crash/restart continuation by persisting recovery cursor + producer session state and replaying pending appends with stable producer sequencing.

## 11.3 Stream/shape handle policy

- shape graph deletion does not require immediate durable data deletion
- recreated shape receives a new stream id (cache busting)
- old stream id is immediately unavailable through protocol behavior (no grace TTL)
- keep only minimal tombstone/redirect metadata required to return protocol-correct stale-handle responses; no continued tail/read service on old stream id
- `offset=-1`/current protocol resolves latest handle path
- stale handle flow remains current Electric protocol (409 + redirect semantics)

## 12. Control-plane behavior

## 12.1 Shape add

1. compile shape to canonical IR
2. optimize and physicalize
3. dedupe against existing graph
4. install operators and increment refs
5. create/attach output sink stream

## 12.2 Shape remove

1. detach sink/output
2. decrement refs upstream
3. recursively remove zero-ref operators
4. write tombstone/redirect metadata only (old stream id immediately unavailable for reads)

## 12.3 Lazy recreate

- no prewarm
- no overlap dual-run
- recreate occurs only when requested again

## 12.4 Shape lifecycle diagram (ASCII)

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

## 13. Runtime, sharding, and scheduling

- one shared graph per tenant database
- stateful operators sharded by key
- stateless chains may be fused
- avoid singleton bottlenecks where possible
- keep attach mode until recipient-local work is unavoidable

## 13.1 Tenant-scoped connection subsystem

Decision:

- one connection subsystem per tenant/upstream database
- each subsystem owns:
  - one replication connection (CDC ingest, non-pooled)
  - one `admin` pool (DDL/publication/control operations)
  - one `snapshot` pool (query-back/upquery reads)

This follows current Electric's effective pattern of per-stack pools with split roles.

Rationale:

- isolates noisy tenants from each other
- separates long-running snapshot/query-back traffic from control-plane SQL
- enables lower-privilege pooled read users while preserving admin capabilities where needed

Sizing policy (initial default):

- configure `total_pool_size` per tenant
- derive pool split:
  - `admin = clamp(total_pool_size / 4, min=1, max=4)`
  - `snapshot = max(total_pool_size - admin, admin)`
- allow per-tenant overrides

Queueing policy:

- `snapshot` pool should use longer queue tolerance (query-back can be bursty/long-lived)
- `admin` pool should favor fast-fail/short queues for control responsiveness

Failure policy:

- if either pool cannot populate to target healthy connections, mark tenant subsystem degraded and restart tenant connection subsystem
- keep failure domain tenant-local (no cross-tenant blast radius)

Recommended substrate split:

- service/control runtime: Tokio (`tokio`) for ingest I/O, proxy I/O, upquery query-back I/O, control-plane tasks
- dataflow runtime: Timely workers for operator scheduling/progress/frontier propagation
- integration boundary: bounded async channels between Tokio tasks and Timely ingress/egress

This keeps high-throughput dataflow scheduling and progress semantics in Timely while leaving network/database I/O in Tokio.

### 13.2 Runtime topology (ASCII)

```
                    +---------------------------+
                    | Tokio control/service RT |
                    | - proxy HTTP             |
                    | - shape attach/remove    |
                    | - adapter mgmt           |
                    +------------+-------------+
                                 |
                  bounded mpsc   |   bounded mpsc
                                 v
                 +-------------------------------+
                 | Timely worker set (tenant)   |
                 | - shared query graph          |
                 | - map/filter/join/semiJoin   |
                 | - fanOutAttach/Explode        |
                 | - frontier/progress           |
                 +---------------+---------------+
                                 |
                         sink batches/deltas
                                 v
                       Durable Streams append

Postgres side:
- replication connection -> Tokio ingest task -> Timely ingress
- snapshot/query-back pool -> Tokio upquery task -> Timely completion
```

### 13.3 Operator state durability and spill options

State classes:

- `control metadata` (must persist): shape catalog, compiled-plan fingerprints, graph attachment metadata, stream bindings, restart cursor metadata
- `replay-derived operator state` (rebuildable): join/semi-join indexes, fanout reverse indexes, recipient attachment sets
- `transient in-flight state` (not persisted): mailbox contents, in-flight upquery waits, short dedupe windows

### 13.3.1 Safe restart strategies

Option A: replay-first recovery (recommended V1)

- persist control metadata + restart cursor only
- rebuild operator state by replaying source changes and issuing upqueries as needed
- rely on sink idempotent writes for duplicate suppression during replay

Pros:

- lowest complexity
- database-agnostic
- no extra write amplification from checkpointing

Cons:

- longer recovery under large replay windows
- higher temporary query-back pressure after restart

Option B: periodic full operator-state checkpoints

- persist selected operator state snapshots at frontier-aligned points
- restart by loading snapshots, then replaying tail deltas

Pros:

- faster warm restarts
- reduced replay/query-back load

Cons:

- significant complexity around consistent checkpoint barriers and schema evolution
- large checkpoint IO

Option C: incremental state log + periodic compact snapshot

- append incremental state mutations and compact periodically
- restart from last compact checkpoint + incremental tail

Pros:

- bounded restart cost with lower full-snapshot overhead

Cons:

- highest implementation complexity (compaction, corruption handling, versioning)

### 13.3.2 Memory offload (spill) strategies

Option M0: memory-only + evict-to-upquery (recommended V1)

- enforce per-operator and per-tenant memory budgets
- evict cold state and recover via upquery on demand

Option M1: local disk spill backend (optional V3)

- state backend keeps hot pages in memory, cold pages on local disk
- useful for high-cardinality joins where upquery churn becomes too expensive

Option M2: remote state service (future)

- external state tier shared across workers/hosts
- operationally heavier; defer until required by multi-host elasticity

### 13.3.3 Release-staged recommendation

V1 (engine and protocol baseline):

- adopt Option A-lite + Option M0
- persist control metadata required for live operation, but no crash-resume continuation contract
- on crash, rebuild graph/operator state from scratch and allow shape/stream re-resolution per protocol path
- keep operator internals non-persistent; use upqueries to refill missing state after restart

V2 (resumability and persistence):

- add restart continuation contract with:
  - persisted `RecoveryCursorStore`
  - persisted producer session state (`Producer-Id`, `Producer-Epoch`, next `Producer-Seq`)
  - persisted pending append intents (outbox) for retry with stable producer sequencing
- recovery cursor is advanced only after append durability is confirmed
- restart resumes same streams without duplicates

V3 trigger criteria for adding M1/B/C:

- restart recovery exceeds SLO even with V2 resumability
- upquery-after-eviction ratio exceeds budget
- tenant memory pressure causes sustained eviction thrash

### 13.3.4 V2 resumable restart flow (ASCII)

```
crash/restart (V2)
    |
    v
load control metadata + producer session + pending outbox
    |
    v
rebuild graph topology (empty operator state)
    |
    v
resume ingest from persisted recovery cursor
    |
    +--> replay deltas through operators (empty indexes refill)
    |
    +--> operators issue upqueries for missing state
    |
    +--> resend pending outbox appends with stable producer tuple
    |
    v
sink appends via Producer-Id/Epoch/Seq
    |
    v
emit frontiers as stability is re-established
```

Global dedupe:

- input dedupe window configurable, default `5ms`

No `fanOutAttach`-specific time-window dedupe in V1.

## 14. Performance invariants and telemetry

Core invariants:

- no unbounded buffering waiting for snapshot completion
- fanout explosion only when required
- column-demand pruning always on
- backpressure explicit on branch queues and sink appends

Required telemetry:

- upquery in-flight count, latency, failure rate
- operator queue depth and processing lag
- frontier lag per source and per sink
- time-without-frontier per sink (provisional duration)
- operator state bytes (hot/in-memory) by operator type
- eviction count and upquery-after-eviction rate
- restart recovery time and replay catch-up throughput
- fanout attach set sizes and explode rates
- demux branch counts, spill to generic rate (when demux enabled)
- consolidate input/output ratios
- durable stream append retry/dedupe counts
- spill hit/miss/read-latency (when spill enabled)

## 15. Release scope (V1/V2/V3)

## 15.1 V1 committed scope

- shared graph and dedup operator reuse
- map/filter/project/join/semi-join/fanout/consolidate/output
- upquery protocol and snapshot-as-upquery
- Postgres adapter first
- durable stream sink with idempotent producer writes
- generic branch + strict fairness, with optional demux branch cap path
- delete/recreate reassignment flow
- memory budgets with evict-to-upquery (no disk spill)
- no crash-resume continuation guarantee; crash recovery is rebuild + protocol re-resolution

## 15.2 V2 committed scope (next)

- resumable crash recovery with no-duplicate continuation on same streams
- persisted recovery cursor + producer session state + pending outbox intents
- deterministic replay + upquery refill on restart from persisted cursor
- compatibility tests for fencing/sequence-gap/retry flows against Durable Streams semantics

## 15.3 V3 candidates

- aggregate operators
- full boolean factoring/routing for mixed `OR`
- adaptive branch specialization and migration
- richer ordered/ranged upqueries
- deeper multi-dimensional version exploitation for recursive pipelines
- optional local spill backend for selected stateful operators
- optional incremental operator-state checkpointing for faster warm restart

## 16. Implementation strategy (concrete)

## 16.0 Proposed Rust stack (V1 baseline)

Execution and async runtime:

- `tokio` for service runtime, timers, sockets, and async orchestration
- `timely` for core dataflow execution/progress
- `futures`/`tokio-stream` for async stream composition

Database ingress/query-back:

- `tokio-postgres` for query-back/upquery SQL reads
- Postgres logical replication client:
  - preferred start: `pgwire-replication` + Galvanic-owned pgoutput decoder behind `IngestAdapter` trait
  - alternate adapter implementation: `pg_walstream` when faster delivery outweighs dependency/control tradeoff
  - fallback: internal protocol implementation over `postgres-protocol` if crate gaps appear

Compiler/IR/parsing:

- canonical IR owned by Galvanic crate(s)
- `pg_query` for Postgres-compatible parsing frontend
- `sqlparser` as optional portable SQL frontend

Graph/state/data structures:

- `petgraph` for control-plane graph structures
- `smallvec` for small recipient sets
- `roaring` for promoted recipient bitmaps
- `indexmap` for deterministic iteration in planning/debuggability
- `StateBackend` abstraction (memory backend in V1; optional local-disk backend in V3)

Service surface and control plane:

- `axum` + `hyper` + `tower` for proxy/control APIs
- `serde`/`serde_json` for protocol and config payloads

Observability and ops:

- `tracing` + `tracing-subscriber` for structured logs
- `metrics` + Prometheus exporter for counters/histograms/gauges
- optional OTel bridge if required by deployment

## 16.1 Postgres replication client decision (V1)

Decision:

- Use `pgwire-replication` with a Galvanic-owned pgoutput decoder as the primary Postgres ingest path.

Alternative reference:

- `pg_walstream` remains the explicit alternative adapter path behind the same `IngestAdapter` interface.
- Switch to it only if we hit concrete delivery blockers on the chosen path (not as a default parallel track).

## Phase 0: scaffolding and contracts

- define core traits/interfaces for adapter, compiler, engine, sink
- define version/frontier abstractions and message envelopes
- define state-backend interface (`StateBackend`) with memory backend default
- establish test harness for deterministic replay

## Phase 1: core execution path

- implement scalar-version execution with frontier propagation
- implement map/filter/project/join/semi-join
- implement up-query request/complete path and failure propagation

## Phase 2: fanout and sink integration

- implement reverse-index-backed `fanOutAttach`
- implement optional `demuxByPlan` path with branch cap and generic overflow
- implement `fanOutExplode`
- wire consolidate and durable stream writes with idempotent producer headers
- enforce memory budgets and eviction policy (`evict-to-upquery`)

## Phase 3: compiler and optimizer depth

- implement canonical IR -> operator IR -> physical IR lowering
- add guard extraction and recipient-dependency analysis
- enforce column-demand and explode-late rules

## Phase 4: protocol compatibility and hardening

- align proxy behavior with current shape protocol and redirect semantics
- validate stale-handle and recreate flows
- run scale and chaos tests for upquery failures and branch overflow

## Phase 5 (V2): resumability and persistence

- implement `RecoveryCursorStore` and producer-session persistence
- implement durable pending-append outbox with retry-on-restart
- validate no-duplicate crash/restart continuation using Durable Streams idempotent producer semantics

## Phase 6 (V3): advanced state acceleration and query depth

- optional local spill backend and selective operator checkpoints
- aggregate operators and richer optimizer/routing pipeline

## 17. Risks and mitigations

Risk: upquery storms under high miss rates  
Mitigation: routing-scope-limited upqueries, branch caps, inflight limits, backpressure, failure fast-path

Risk: incorrect ordering between live changes and query-back responses  
Mitigation: adapter-level barrier/version rules and explicit frontier semantics

Risk: fanout explosion from premature explode placement  
Mitigation: optimizer explode-late invariant + telemetry guardrails

Risk: complexity drift in optimizer  
Mitigation: V1 baseline correctness path always available (`AND` split only), feature-flag advanced rewrites

Risk: protocol regressions for handle rotation and cache behavior  
Mitigation: compatibility tests against current Electric protocol behavior

Risk: V1 crash causes stream/session reset instead of seamless continuation  
Mitigation: make this explicit in V1 contract; prioritize V2 resumability immediately after V1 baseline

Risk: no-duplicate continuation depends on correct Durable Streams idempotent semantics + producer state durability  
Mitigation: enforce protocol-level conformance tests for `Producer-Id/Epoch/Seq`, fencing, sequence-gap handling, and crash retry paths

## 18. Open questions for team review

1. What are initial per-tenant resource limits (max in-flight upqueries, queue depth, branch caps override)?
2. What is the exact durable-stream retention policy for rotated stream ids that are protocol-inaccessible?
3. Which second database adapter should be prioritized after Postgres (MySQL vs MongoDB)?
4. What V1 crash contract do we accept explicitly (rebuild + stream re-resolution), and what date target do we set for V2 resumable continuation?
5. What restart recovery SLO do we commit to for V2 (e.g. p95 recover-to-frontier under target tenant sizes)?

## 19. Gap closure from current Electric architecture review

The current sync-service architecture reveals several constraints that Galvanic must address explicitly in V1, not as future cleanup.

### 19.1 Non-blocking fanout dispatch is mandatory

Current Electric routes replication fragments synchronously to all affected shape consumers.
This creates a head-of-line risk where one slow/blocked consumer can stall global ingest progress.

Galvanic requirement:

- ingest/route path must never synchronously wait on per-shape/operator processing completion
- per-operator mailboxes must be bounded, with explicit overload policy (backpressure, fail-fast, or shape invalidation)
- frontier advancement must be decoupled from single-recipient latency outliers

### 19.2 Subquery capability boundary must be compiler-enforced

Current Electric supports useful `IN (subquery)` paths but still has runtime invalidation fallbacks for specific boolean forms and multi-subquery cases.

Galvanic requirement:

- define V1 accepted query subset at compile time (semi-join focused)
- reject unsupported patterns at compile time with explicit error codes
- avoid runtime "invalidate shape and refetch" as normal control flow for unsupported logic

### 19.3 Snapshot/live interleaving contract must be formalized

Current Electric has explicit buffering/filtering state around initial snapshot correctness.
Galvanic chooses minimal buffering and "no frontier yet == provisional", which is valid only with clear downstream invariants.

Galvanic requirement:

- every emitted row must carry a comparable source version
- sink `consolidate` must be version-aware and idempotent over out-of-order arrival between live and up-query rows
- frontier emission must remain blocked until snapshot/up-query completion guarantees are satisfied for that shape output

### 19.4 "Return all shapes on filter error" fallback must not exist

Current Electric uses correctness-safe but high-blast-radius fallback when filter/index evaluation fails unexpectedly.

Galvanic requirement:

- scope failures to the smallest graph region possible (operator/shape-level)
- never convert a local filter error into global fanout amplification
- include explicit operator health/error channels and fast isolation/removal behavior

### 19.5 HTTP/proxy compatibility must preserve cache/chunk semantics

Current Electric behavior depends heavily on chunk-aware offsets, ETag behavior, and stale-handle redirect semantics.

Galvanic requirement:

- preserve `offset=-1`, `handle`, 409 must-refetch semantics
- preserve chunk boundary semantics for cache efficiency
- make durable-stream read API expose stable chunk/etag boundaries expected by proxy/CDN

### 19.6 Shape scale target implies no process-per-shape runtime model

Current Electric uses per-shape consumer/materializer process patterns that are effective at current scale but do not match million-shape targets.

Galvanic requirement:

- shared graph operators must be multiplexed over many shapes
- shape attachment should be metadata and index updates, not process spawning
- refcount and GC remain shape-aware, while execution remains operator-centric

## 20. References

- Noria thesis (primary): https://pdos.csail.mit.edu/papers/jfrg:thesis.pdf
- Noria thesis (alternate mirror used in discussion): https://jon.thesquareplanet.com/papers/phd-thesis.pdf
- Noria codebase (implementation reference): https://github.com/mit-pdos/noria
- Timely dataflow docs (progress/frontiers): https://timelydataflow.github.io/timely-dataflow/
- Differential dataflow docs (arrangements/compaction): https://timelydataflow.github.io/differential-dataflow/
- Feldera docs (incremental SQL pipelines): https://docs.feldera.com/
- Materialize docs (incremental materialized views): https://materialize.com/docs/sql/create-materialized-view/
- `pgwire-replication` crate/docs: https://crates.io/crates/pgwire-replication
- `pg_walstream` crate/docs: https://crates.io/crates/pg_walstream
- Durable Streams protocol (idempotent producer semantics): `durable-streams/PROTOCOL.md`
- Local notes: `stuff/possible_design.md`
- Local notes: `stuff/wal_lsn_query_back.md`
- TanStack DB IR/compiler references:
  - `db/packages/db/src/query/ir.ts`
  - `db/packages/db/src/query/optimizer.ts`
  - `db/packages/db/src/query/compiler/index.ts`
  - `db/packages/db-ivm/src/multiset.ts`
  - `db/packages/db-ivm/src/operators/consolidate.ts`
