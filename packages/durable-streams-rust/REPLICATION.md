# Replicated durability (`--durability replicated`)

Kafka-style durability for the durable-streams server: instead of making an
append durable with a local WAL `fdatasync`, the append is **replicated to a
quorum of servers** and acked once the replication log has _decided_ it. The
fsync leaves the hot path entirely — durability comes from independent failure
domains, exactly like a Kafka produce with `acks=all` against an in-memory
(page-cache) log.

The consensus layer is **[OmniPaxos]** (Apache-2.0, pinned to an upstream git
rev — [see why](#why-the-omnipaxos-dependency-is-a-pinned-git-rev)) — a
Sequence Paxos implementation from KTH purpose-built for replicated logs, with
leader election (Ballot Leader Election), reconfiguration support, and a
bring-your-own-network design that lets us keep our own TCP mesh.

[OmniPaxos]: https://omnipaxos.com/

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
                        │            (omnipaxos; follower proposals are
                        │             auto-forwarded to the leader)
                        ▼
                 ...decided by quorum...
                        ▼
              applier task (every node, log order)
                        │  authoritative checks (closed / producer dedup / seq)
                        │  appender lock → write_wire → publish_durable_tail
                        ▼
              origin node: resolve pending ack → HTTP response
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

- **Any node accepts writes.** OmniPaxos forwards proposals from followers to
  the current leader; the ack still resolves on the node that took the HTTP
  request (it applies the decided entry locally and completes the response).
  No client-side leader routing, no 307 redirects. Writing to the leader saves
  one network hop.
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
- **Applies are sharded.** Decided entries dispatch to a small pool of
  applier tasks (stream path → shard; per-stream log order preserved,
  fork-creates barrier and apply inline). Benchmarks showed a single inline
  applier lets one slow store write (an fs-journal stall) block consensus and
  every other stream's ack — 100–450 ms tails. Two corollaries: dirty meta
  sidecars are swept per shard every ~3 s instead of rewritten per append,
  and trim is only safe because entries are cloned out of the consensus log
  at dispatch. A Compaction message is never handled before the dispatch
  cursor catches up (trim-vs-apply race guard — found by the DST-style
  reasoning below, visible in production as leaked acks).

### The consensus core

One OmniPaxos instance (a single consensus group / "partition") per cluster,
running in a dedicated tokio task:

- **Proposals** arrive on an mpsc channel from HTTP handlers; each carries a
  `(origin_node, req_id)` tag used to resolve the pending ack when the entry
  is later applied on the origin node. If the entry never decides (leader
  change dropped a forwarded proposal), the handler times out
  (`--repl-ack-timeout-ms`) and returns 503 — the client retry is deduped by
  producer headers.
- **Ticks** every 10 ms drive Ballot Leader Election and message resends
  (election timeout 500 ms, resend 1 s).
- **Networking** is a plain TCP mesh: one outbound connection per peer with
  automatic reconnect, length-prefixed bincode frames. Lost messages are
  reissued by OmniPaxos's resend timer, so links can drop without correctness
  impact.
- **Batching**: OmniPaxos coalesces all outstanding entries into single
  Accept messages, so the effective batch size scales with load — one
  consensus RTT amortizes across every append in flight, the same shape as
  the WAL's group commit.
- **Trim**: every `--repl-trim-secs` (default 5 s) the core trims the log
  prefix that _all_ replicas have decided, bounding memory. The stream files
  remain the real storage; the consensus log is only the replication conduit.

### Storage

The OmniPaxos log lives in memory (`replication::mem_storage`, vendored from
`omnipaxos_storage::MemoryStorage`). That is deliberate: the whole point of
the mode is that durability comes from replication, not disk. See the
trade-offs below for what that assumes.

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
2. **Fail-stop assumption / no restart-rejoin in v1.** Ballot promises and
   the log are in memory, so a crashed replica must not rejoin the running
   cluster with the same id after amnesia (classic Paxos requirement), and the
   trimmed log couldn't catch it up anyway. v1 operational rule: **a failed
   node stays down; to recover full redundancy, restart the cluster** (fresh
   data dirs) during a maintenance window. Snapshot-based state transfer +
   durable ballot state are the roadmap items that lift this.
3. **One consensus group.** All streams share one decided sequence — a single
   ordering pipeline (like a 1-partition Kafka topic, though batching makes
   the pipeline wide). Sharding streams across N groups is a natural follow-up
   if the single group's decide throughput becomes the ceiling.
4. **One RTT to quorum on every ack** (plus one forward hop when the write
   lands on a follower). That's the price of durability-by-replication; with
   batch_accept it's paid once per in-flight window, not once per append.
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
  [--repl-ack-timeout-ms 10000]       # propose→decide wait before 503
  [--repl-trim-secs 5]                # log trim cadence; 0 = never trim
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
  holds only the un-trimmed window (seconds of traffic) in memory.
- **What to monitor**: `decided_idx` advancing on all nodes; a node whose
  `decided_idx` stalls while others advance has lost its mesh links.

## Why the omnipaxos dependency is a pinned git rev

crates.io `omnipaxos 0.2.2` (Nov 2023, the latest published release) has a
consensus **safety bug** that our deterministic simulation reproduces in
seconds: a follower's cached Promise message is not cleared when the new
leader syncs it (AcceptSync), so a Promise resend after a partition + leader
change feeds the new leader stale log state — the decided logs diverge and an
**acked entry disappears on the new leader**. Fixed upstream post-release
(`e6ddc52 "Clear cached_promise_message when handling AcceptSync"`, Jan 2024)
but never published to crates.io. We pin upstream `main`
(`bd234be2…`), which also carries two leader-election fixes (#154, #156).
`replication/sim_tests.rs` fails within ~10 seeds on 0.2.2 and passes 200+
seeds on the pinned rev.

## Validation

- `replication/tests.rs` — 3-node in-process clusters over real loopback TCP:
  convergence, follower proposals, replicated producer dedup, close/delete,
  forks.
- `replication/sim_tests.rs` — **deterministic simulation with fault
  injection**: seeded message drops, partition (delay) windows, crash-stop of
  any one node (leader included), elections, resends, and active trimming,
  against real stores through the real apply functions. Invariants: acked
  appends survive on every live node, exactly once, in producer-seq order;
  replicas byte-identical; bounded-time quiescence; compaction actually ran.
  `DS_REPL_SIM_SEEDS=200 cargo test replication_dst` runs 200 seeds in ~4 s;
  reproduce a failure with `DS_REPL_SIM_SEED0=<seed>`.
  The fault model is deliberately exactly the production mesh's contract:
  per-link FIFO with loss — no reordering/duplication, which TCP excludes and
  OmniPaxos's session-numbered protocol does not tolerate.
- `deploy/replicated/smoke.sh` — end-to-end HTTP incl. leader kill-over.

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

- **Snapshot / state transfer** — stream-file shipping so a fresh or restarted
  replica can join a running cluster past the trimmed log.
- **Durable ballot state** — fsync the (tiny, election-time-only) promise
  state so fast restart-rejoin is Paxos-safe; off the append hot path.
- **Sharded consensus groups** — hash streams across N OmniPaxos instances
  when a single group's decide pipeline saturates.
- **Reconfiguration** — OmniPaxos supports membership change (StopSign); wire
  it to an admin endpoint to replace nodes without full restart.
- **Bench integration** — a `replicated` deploy mode in ds-bench
  (`scripts/bench`) to put numbers on the wal / memory / replicated triangle
  on real (separate-machine) hardware.
- **Large-payload copy reduction** — a 16 KB append is copied ~4× per node
  (propose → log → decided-read → apply, plus per-peer serialization); at 256 B
  this is noise, at 16 KB it is the throughput gap vs memory mode. `Arc<[u8]>`
  payloads + `serde_bytes` would remove most of it.
