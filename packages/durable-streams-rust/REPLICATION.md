# Replicated durability (`--durability replicated`)

Kafka-style durability for the durable-streams server: instead of making an
append durable with a local WAL `fdatasync`, the append is **replicated to a
quorum of servers** and acked once the replication log has _decided_ it. The
fsync leaves the hot path entirely — durability comes from independent failure
domains, exactly like a Kafka produce with `acks=all` against an in-memory
(page-cache) log.

The consensus layer is **[openraft]** (MIT/Apache-2.0) — an actively
maintained, production-proven Raft (Databend, CnosDB, RobustMQ) with
snapshots, joint-consensus membership change, and a bring-your-own network +
storage design that lets us keep our own TCP mesh and in-memory log. It
replaced OmniPaxos — [see the history](#history-why-openraft).

[openraft]: https://github.com/databendlabs/openraft

- [The model](#the-model)
- [Design: log-first apply](#design-log-first-apply)
- [What is replicated](#what-is-replicated)
- [Guarantees and trade-offs](#guarantees-and-trade-offs)
- [Configuration](#configuration)
- [Deploying a cluster](#deploying-a-cluster)
- [Operations](#operations)
- [Roadmap](#roadmap)

## The model

The existing durability modes are two points on a spectrum:

| mode             | ack means                                              | survives                             |
| ---------------- | ------------------------------------------------------ | ------------------------------------ |
| `wal`            | record fdatasync'd in the sharded WAL                  | single-node crash & power loss       |
| `memory`         | record in the page cache                               | nothing (process restart at best)    |
| **`replicated`** | **record decided by a quorum of replicas (in memory)** | **loss of any minority of replicas** |

`replicated` mode is `memory` mode's write path plus a consensus round:
no fsync anywhere on the append path. A 3-node cluster tolerates the total
loss of any 1 node with zero data loss; what it does _not_ survive is the
simultaneous loss of a majority (e.g. a coordinated power failure of 2/3
nodes) — the same trade Kafka makes with `acks=all` +
`log.flush.interval.messages=MAX` (flush left to the OS).

## Design: log-first apply

The single most important design decision: **in replicated mode, every
state-mutating operation is applied to the store only from the decided
consensus log — on every node, including the leader.**

```
client ── POST /s ──▶ handler (any node)
                        │  parse + validate (best-effort pre-checks)
                        │  encode_wire
                        ▼
                  propose LogOp::Append{path, wire, producer, close}
                        │     (raft client_write; on a follower the op is
                        │      forwarded to the leader over the RPC mesh)
                        ▼
                 ...committed by quorum...
                        ▼
        state machine apply (every node, log order, sharded by stream)
                        │  authoritative checks (closed / producer dedup / seq)
                        │  appender lock → write_wire → publish_durable_tail
                        ▼
        client_write resolves with the APPLY OUTCOME → HTTP response
        (forwarded acks additionally wait for the origin node's own apply
         to cover the entry — read-your-writes on the node you wrote to)
```

Contrast with the WAL path, where the handler writes the stream file first and
then waits for the fsync. Writing first doesn't work under replication: a
leader that writes locally, proposes, and then loses leadership before the
proposal decides is left with bytes in its file that the rest of the cluster
never saw — its offsets have diverged forever. With log-first apply the store
on every node is a deterministic function of the decided log prefix, so
replicas can never diverge, and leader fail-over needs no truncation/repair
protocol.

Consequences:

- **Any node accepts writes.** A non-leader node forwards the op to the
  leader over the RPC mesh and relays the apply outcome; before responding it
  waits until its OWN state machine has applied the entry, so the client
  keeps read-your-writes on the node it wrote to. No client-side leader
  routing, no 307 redirects. Writing to the leader saves one network hop.
- **Every node serves reads.** The applier calls the same
  `publish_durable_tail` as the other modes, so catch-up reads, long-poll and
  SSE fan-out work identically on followers (Kafka "follower fetch", for
  free). Follower reads are sequentially consistent, not linearizable: a
  follower may briefly lag the leader's decided frontier.
- **Authoritative checks run at apply time.** Producer dedup / epoch fencing /
  `Stream-Seq` / closed-stream conflicts are evaluated inside the applier, in
  log order — deterministic on every replica. The handler runs the same checks
  best-effort _before_ proposing only to fail fast with 4xx without burning a
  consensus round.
- **The ack is an apply outcome, not just "decided".** The proposing node
  resolves the client's response with the outcome the applier computed
  (offset, duplicate, conflict, …), so responses are identical to the
  single-node modes.
- **Applies are sharded.** Within each state-machine apply batch, entries
  are sharded by stream path (per-stream log order preserved; fork-creates
  barrier and apply inline). Benchmarks showed a single sequential applier
  lets one slow store write (an fs-journal stall) block every other stream's
  ack — 100–450 ms tails. Dirty meta sidecars are swept every ~3 s instead of
  rewritten per append (the rename churn was the stall source).
- **One benign race to know about:** the fast-fail 4xx pre-checks run against
  the LOCAL store, which on a follower may lag the leader by a beat — e.g. an
  append that arrives on node C right after its stream's create was acked via
  node A can see a 404 (~1 in 10⁵ under round-robin load). It is retryable,
  exactly like Kafka's UNKNOWN_TOPIC right after topic creation.

### The consensus core

One openraft instance (a single consensus group / "partition") per cluster:

- **Proposals** are `Raft::client_write(LogOp)` calls from the HTTP handlers;
  the future resolves with the apply outcome — there is no hand-rolled
  pending-ack map. If nothing resolves within `--repl-ack-timeout-ms`
  (election in progress, dropped forward, stalled quorum) the handler returns
  503 — the client retry is deduped by producer headers.
- **Election/heartbeat**: 100 ms heartbeats, 500–1000 ms election timeout —
  fail-over behavior matches the previous incarnation (~0.5–1 s stall).
- **Networking** is a plain TCP RPC mesh: one persistent, auto-reconnecting
  connection per peer, length-prefixed bincode frames with correlation ids,
  carrying openraft's AppendEntries/Vote/InstallSnapshot plus our
  forward-to-leader proposal RPC. openraft retries failed RPCs.
- **Batching**: openraft pipelines and batches AppendEntries under load — one
  replication RTT amortizes across every append in flight, the same shape as
  the WAL's group commit.
- **Log purge**: every `--repl-snapshot-logs` entries (default 5000) each
  node takes a METADATA-ONLY marker snapshot and openraft purges the log
  behind it, bounding the in-memory log per node — a down peer does NOT block
  reclamation (an improvement over the omnipaxos trim, which needed all
  nodes). The stream files remain the real storage; the consensus log is only
  the replication conduit.

### Storage

The Raft log and vote live in memory (`replication::log_store`, vendored from
openraft's reference memstore). That is deliberate: the whole point of the
mode is that durability comes from replication, not disk. Snapshots are
metadata-only markers — building one is how the log purges; installing one is
REFUSED loudly, so a follower that fell behind the purge horizon stays behind
(fail-stop) instead of silently diverging. See the trade-offs below.

## What is replicated

Every mutation of stream state goes through the log:

| op                            | LogOp                                                     | apply                                                             |
| ----------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------- |
| `PUT /s` (create, incl. fork) | `Create{path, config, parent, base_offset, initial wire}` | `store.create` + optional first append                            |
| `POST /s` (append / close)    | `Append{path, wire, producer, seq, close}`                | checks → `write_wire` → `publish_durable_tail` (+ closed publish) |
| `DELETE /s`                   | `Delete{path}`                                            | `delete_or_soft_delete`                                           |

Fork-point resolution (offset scanning) happens on the proposing node; the
resolved `base_offset` is what's replicated, so the applier never does read
I/O. Reads (`GET`, `HEAD`) are local and hit no consensus.

## Guarantees and trade-offs

Accepted trade-offs, stated plainly:

1. **Quorum-memory durability.** An acked append survives any minority
   failure (1 of 3, 2 of 5). It does not survive simultaneous power loss of a
   majority. Deploy replicas across failure domains (zones) to make that
   event as unlikely as your availability target requires.
2. **Fail-stop assumption / no restart-rejoin in v1.** The Raft vote and log
   are in memory, so a crashed replica must not rejoin the running cluster
   with the same id after amnesia (classic consensus requirement), and a
   purged log couldn't catch it up anyway (snapshots are markers; installing
   one is refused). v1 operational rule: **a failed node stays down; to
   recover full redundancy, restart the cluster** (fresh data dirs) during a
   maintenance window. Real snapshots (stream-file state transfer) + a
   durable vote are the roadmap items that lift this — both natural fits in
   openraft.
3. **One consensus group.** All streams share one decided sequence — a single
   ordering pipeline (like a 1-partition Kafka topic, though batching makes
   the pipeline wide). Sharding streams across N groups is a natural follow-up
   if the single group's decide throughput becomes the ceiling.
4. **One RTT to quorum on every ack** (plus one forward hop when the write
   lands on a follower). That's the price of durability-by-replication; with
   AppendEntries batching it's paid once per in-flight window, not once per
   append.
5. **Latency under leader failure.** Appends stall until the election timeout
   (~500 ms) elects a new leader; in-flight proposals on the old leader time
   out with 503 and are safe to retry (producer dedup).
6. **Tiering (`--tier`) is not supported with `replicated`** in v1 — every
   node would independently offload to S3. Run with tiering off.

## Configuration

```
durable-streams-server \
  --durability replicated \
  --repl-id 1 \
  --repl-peers 1@ds1:5433,2@ds2:5433,3@ds3:5433 \
  [--repl-listen 0.0.0.0:5433]        # default: the port from our own peers entry
  [--repl-ack-timeout-ms 10000]       # propose→commit+apply wait before 503
  [--repl-snapshot-logs 5000]         # marker-snapshot/purge cadence, in log entries
```

- `--repl-id` — this node's id (1-based, must appear in `--repl-peers`).
- `--repl-peers` — the **full cluster membership including this node**, as
  `id@host:port` of the replication (peer) listeners. Must be identical on
  every node. 3 or 5 nodes are the sensible sizes.
- The HTTP `--port` (default 4437) is unchanged and independent.

## Deploying a cluster

Three ways, smallest to largest. All live in [`deploy/replicated/`](deploy/replicated/).

### 1. Local processes (development)

```
deploy/replicated/local-cluster.sh up      # builds + starts a 3-node cluster on
                                           # http ports 4437/4438/4439
deploy/replicated/local-cluster.sh status  # per-node /_repl/status
deploy/replicated/local-cluster.sh down
```

### 2. docker compose

```
cd deploy/replicated && docker compose up --build -d
# HTTP on localhost:4437, :4438, :4439
```

### 3. Kubernetes

```
kubectl apply -f deploy/replicated/k8s.yaml
```

A 3-replica StatefulSet + headless service; each pod derives `--repl-id` from
its ordinal. Spread pods across zones with a topologySpreadConstraint for real
failure-domain independence. See the manifest comments.

### Smoke test

`deploy/replicated/smoke.sh` runs an end-to-end check against a local cluster:
create → append on one node → read from another → kill the leader → append
again (fail-over) → verify byte-identical streams on the survivors.

## Operations

- **`GET /_repl/status`** on any node returns
  `{"id":1,"leader":2,"decided_idx":1234,"connected_peers":[2,3]}` — use it
  for readiness checks (`leader != null`) and to find the leader for
  lowest-latency writes.
- **Sizing**: replication traffic ≈ append traffic × (n-1). The consensus log
  holds ≤ `--repl-snapshot-logs` + a small margin of entries per node in
  memory (log RSS ≈ that × payload size — lower the flag for large payloads).
- **What to monitor**: `decided_idx` advancing on all nodes; a node whose
  `decided_idx` stalls while others advance has lost its mesh links.

## History: why openraft

The first implementation used **OmniPaxos** (Sequence Paxos, the only serious
Rust Paxos library). Two things forced the change:

1. Our deterministic simulation caught a consensus **safety bug** in the last
   published release (0.2.2, Nov 2023): a follower's cached Promise message
   was not cleared on AcceptSync, so a Promise resend after a partition +
   leader change fed the new leader stale log state — the decided logs
   diverged and an acked entry vanished on the new leader. The fix existed
   upstream (Jan 2024) but was never published.
2. The project is effectively unmaintained, so we were pinned to a git rev of
   an abandoned main branch.

openraft is actively maintained (Databend, CnosDB in production), and the
architecture — log-first apply, apply-outcome acks, sharded appliers, the TCP
mesh, producer-dedup retry safety — carried over intact; the swap touched the
consensus adapter layer only (`types/log_store/sm/net/core`). Two behavioral
improvements came for free: log purge no longer needs every peer up, and the
ack path lost its hand-rolled pending map (`client_write` returns the apply
outcome). The omnipaxos incarnation, including the message-level
deterministic simulation that caught the bug above, lives in git history
(`git log --follow src/replication/`).

## Validation

- `replication/tests.rs` — 3-node in-process clusters over real loopback TCP:
  convergence, follower forwarding, replicated producer dedup, close/delete,
  forks, frequent snapshot/purge (`snapshot_logs: 64`).
- `deploy/replicated/smoke.sh` — end-to-end HTTP incl. leader kill-over.
- openraft brings its own extensive consensus test/chaos suites.
- ROADMAP: port the message-level deterministic simulation (drops, partition
  windows, crash-stop, seeded) to openraft via a simulated `AsyncRuntime` —
  the harness design is in git history and it has already paid for itself
  once.

## Benchmarks (local 3-node cluster, 10-core M-series, 2026-07-03)

All three replicas + the ds-bench client share one machine, so absolute
numbers are conservative; the memory-mode column is the same box's ceiling.
ds-bench `multi-stream`, 200 streams, `--repl-trim-secs 5`.

| payload | conns | replicated                        | single-node `memory` | notes                              |
| ------- | ----- | --------------------------------- | -------------------- | ---------------------------------- |
| 256 B   | 32    | 40k ops/s, p50 0.7 ms, p99 2.1 ms | 96k ops/s, p50 0.28  |                                    |
| 256 B   | 128   | 52k ops/s, p50 1.9 ms, p99 9 ms   | 100k ops/s           | replicated saturates ≈ 55k/s       |
| 16 KB   | 32    | 10.7k ops/s (175 MB/s), p99 18 ms | 35k ops/s (580 MB/s) | byte copies dominate — see roadmap |

Sustained (5 min, open loop): 256 B × 22.6k/s — RSS flat at 77 MB, log window
sawtooths ≤ 115k entries (= rate × trim cadence), zero ack timeouts. 16 KB at
saturation — RSS sawtooths 0.2–0.6 GB (= window × payload), still bounded,
zero timeouts, all replicas byte-identical. **Sizing rule: consensus-log RSS ≈
append bytes/s × (`--repl-trim-secs` + decide lag); at large payloads set
`--repl-trim-secs 1`.** Watch `REPL_STATS` (`--repl-stats N`): `window` flat ⇒
trim keeping up; `apply_max_us` large with idle CPU ⇒ store stalls;
`timeouts` climbing ⇒ dropped forwards or a dead quorum.

## Roadmap

- **Real snapshots / state transfer** — stream-file shipping via openraft's
  snapshot machinery so a fresh or restarted replica can join a running
  cluster past the purged log (replaces the marker-snapshot refusal).
- **Durable vote** — fsync the (tiny, election-time-only) Raft vote so fast
  restart-rejoin is safe; off the append hot path.
- **Membership change** — wire `Raft::change_membership` (joint consensus,
  learners) to an admin endpoint to replace nodes without full restart.
- **Deterministic simulation** — port the seeded fault-injection harness
  (git history: `replication/sim_tests.rs`) to openraft via a simulated
  `AsyncRuntime`.
- **Sharded consensus groups** — hash streams across N Raft groups when a
  single group's commit pipeline saturates.
- **Large-payload copy reduction** — `Arc<[u8]>` payloads + `serde_bytes`;
  16 KB appends are still copied several times per node.
- **Bench integration** — a `replicated` deploy mode in ds-bench
  (`scripts/bench`) to put numbers on the wal / memory / replicated triangle
  on real (separate-machine) hardware.
