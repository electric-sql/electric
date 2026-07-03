//! Deterministic replication simulation (DST) with fault injection.
//!
//! Each seed drives a 3-node cluster with the consensus instances wired to a
//! SIMULATED network — seeded message drops, duplication, reordering,
//! partition windows, and a crash-stop of one node (possibly the leader) —
//! no TCP, no tokio timing, fully deterministic from the seed. Store
//! mutations go through the REAL apply functions
//! (`handlers::apply_replicated_*`) against real on-disk stores, and the
//! production trim-vs-apply guard is replicated at the message layer (apply
//! everything decided before handling a Compaction), with trims fired
//! throughout, so the pipeline that benchmarks run is the pipeline fuzzed
//! here.
//!
//! The client model is a per-stream idempotent producer: one outstanding
//! append per stream, retried (same producer seq, fresh attempt, possibly a
//! different node) until acked — exactly the retry discipline the protocol
//! prescribes after a 503.
//!
//! Invariants asserted at quiescence:
//!   I1 acked durability + order: every live node's stream content is EXACTLY
//!      the in-seq concatenation of the acked payloads (each present once —
//!      dedup — and in producer-seq order).
//!   I2 convergence: tails and bytes byte-identical across live nodes.
//!   I3 liveness: with a quorum alive and faults healed, every client op
//!      acks and every node applies the full decided log (bounded rounds).
//!   I4 the run actually trimmed (compacted > 0) — the invariants hold WITH
//!      compaction active, not because it never ran.
//!
//! Reproduce a failure with the seed printed in the panic message:
//! `DS_REPL_SIM_SEED0=<seed> DS_REPL_SIM_SEEDS=1 cargo test replication::sim`.

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::Arc;

use omnipaxos::messages::Message;
use omnipaxos::util::LogEntry;
use omnipaxos::{ClusterConfig, OmniPaxos, OmniPaxosConfig, ServerConfig};

use super::entry::{AppendApplyOutcome, LogOp, ReplEntry, ReplProducer};
use super::mem_storage::MemStorage;
use crate::store::{Store, StreamConfig};
use crate::tier::TierConfig;

// ---------------------------------------------------------------------------
// Deterministic PRNG (splitmix64) — same helper as wal::sim_tests.
// ---------------------------------------------------------------------------

struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Self {
        Rng(seed)
    }
    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
    fn below(&mut self, n: u64) -> u64 {
        if n == 0 {
            0
        } else {
            self.next_u64() % n
        }
    }
    fn chance(&mut self, percent: u64) -> bool {
        self.below(100) < percent
    }
}

// ---------------------------------------------------------------------------
// Simulated cluster
// ---------------------------------------------------------------------------

const N: u64 = 3;
const STREAMS: usize = 5;
const ROUNDS: u64 = 3000;
/// Client retry timeout, in rounds (the sim's "503 → retry" clock).
const RETRY_ROUNDS: u64 = 120;
/// Per-message drop probability. NOTE the fault model is deliberately exactly
/// the production mesh's: per-link FIFO with loss (TCP + bounded outboxes
/// that drop on overflow/reconnect) — no within-link reordering and no
/// duplication, which TCP excludes and which OmniPaxos's session-based
/// protocol does not tolerate (a stale reordered AcceptDecide truncates and
/// replays the follower log suffix). Cross-link interleaving is still fully
/// random.
const DROP_PCT: u64 = 5;

/// Fault-mix toggles for bisecting failures (default: all on).
fn fault_enabled(name: &str) -> bool {
    std::env::var(format!("DS_REPL_SIM_NO_{name}")).is_err()
}

type Msg = Message<ReplEntry>;

struct SimNode {
    id: u64,
    op: OmniPaxos<ReplEntry, MemStorage<ReplEntry>>,
    store: Arc<Store>,
    applied: usize,
    crashed: bool,
    /// Diagnostic trace of applied append ops: (log_pos, stream, seq, outcome).
    trace: Vec<(usize, usize, u64, &'static str)>,
}

impl SimNode {
    fn new(id: u64, tag: &str, seed: u64) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "ds-repl-sim-{tag}-{seed}-{id}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let cfg = OmniPaxosConfig {
            cluster_config: ClusterConfig {
                configuration_id: 1,
                nodes: (1..=N).collect(),
                flexible_quorum: None,
            },
            server_config: ServerConfig {
                pid: id,
                election_tick_timeout: 5,
                resend_message_tick_timeout: 10,
                ..Default::default()
            },
        };
        SimNode {
            id,
            op: cfg.build(MemStorage::default()).unwrap(),
            store: Arc::new(Store::new_with_tier(dir, TierConfig::default()).unwrap()),
            applied: 0,
            crashed: false,
            trace: Vec::new(),
        }
    }
}

/// One client append: retried (same producer seq) until some attempt acks.
struct ClientOp {
    stream: usize,
    seq: u64,
    payload: String,
    /// req_ids of in-flight attempts (resolution is keyed on origin's req_id).
    attempts: BTreeSet<u64>,
    last_attempt_round: u64,
    acked: bool,
}

struct Sim {
    rng: Rng,
    nodes: Vec<SimNode>,
    /// (from, to) → in-flight messages. BTreeMap: deterministic iteration.
    links: BTreeMap<(u64, u64), VecDeque<Msg>>,
    /// Links currently partitioned (messages dropped), with heal round.
    partitions: BTreeMap<(u64, u64), u64>,
    round: u64,
    next_req: u64,
    /// req_id → index into `ops` (attempt resolution).
    attempt_of: BTreeMap<u64, usize>,
    ops: Vec<ClientOp>,
    /// Next producer seq per stream (one outstanding op per stream).
    next_seq: Vec<u64>,
    outstanding: Vec<Option<usize>>,
    rejected_attempts: u64,
    crashes_done: u32,
}

impl Sim {
    fn new(tag: &str, seed: u64) -> Self {
        let nodes: Vec<SimNode> = (1..=N).map(|id| SimNode::new(id, tag, seed)).collect();
        let mut links = BTreeMap::new();
        for a in 1..=N {
            for b in 1..=N {
                if a != b {
                    links.insert((a, b), VecDeque::new());
                }
            }
        }
        Sim {
            rng: Rng::new(seed),
            nodes,
            links,
            partitions: BTreeMap::new(),
            round: 0,
            next_req: 1,
            attempt_of: BTreeMap::new(),
            ops: Vec::new(),
            next_seq: vec![0; STREAMS],
            outstanding: vec![None; STREAMS],
            rejected_attempts: 0,
            crashes_done: 0,
        }
    }

    fn live(&self) -> Vec<usize> {
        (0..self.nodes.len()).filter(|&i| !self.nodes[i].crashed).collect()
    }

    fn stream_path(s: usize) -> String {
        format!("/v1/stream/sim{s:03}")
    }

    /// Drain a node's outgoing consensus messages into the link queues.
    fn pump(&mut self, i: usize) {
        if self.nodes[i].crashed {
            return;
        }
        let mut buf = Vec::new();
        self.nodes[i].op.take_outgoing_messages(&mut buf);
        for m in buf {
            let key = (self.nodes[i].id, m.get_receiver());
            if let Some(q) = self.links.get_mut(&key) {
                q.push_back(m);
            }
        }
    }

    /// Apply everything decided on node `i` through the REAL apply functions;
    /// resolve client attempts that originated on it.
    fn apply_decided(&mut self, i: usize) {
        let decided = self.nodes[i].op.get_decided_idx();
        if decided <= self.nodes[i].applied {
            return;
        }
        let entries = self.nodes[i].op.read_decided_suffix(self.nodes[i].applied);
        let mut log_pos = self.nodes[i].applied;
        if let Some(entries) = entries {
            for le in entries {
                log_pos += 1;
                let LogEntry::Decided(e) = le else {
                    panic!("non-decided entry in decided suffix (trim raced apply?)");
                };
                let dbg_key = match &e.op {
                    LogOp::Append { path, producer, .. } => {
                        Some((path.clone(), producer.as_ref().map(|p| p.seq).unwrap_or(0)))
                    }
                    _ => None,
                };
                let store = Arc::clone(&self.nodes[i].store);
                let node_id = self.nodes[i].id;
                let outcome = block_on(async {
                    match e.op {
                        LogOp::Create {
                            path,
                            config,
                            base_offset,
                            wire,
                        } => {
                            crate::handlers::apply_replicated_create(
                                &store, &path, config, base_offset, wire,
                            )
                            .await;
                            None
                        }
                        LogOp::Append {
                            path,
                            wire,
                            producer,
                            seq,
                            close,
                        } => Some(
                            crate::handlers::apply_replicated_append(
                                &store, &path, wire, producer, seq, close,
                            )
                            .await,
                        ),
                        LogOp::Delete { path } => {
                            crate::handlers::apply_replicated_delete(&store, &path).await;
                            None
                        }
                    }
                });
                if let (Some((path, seq)), Some(out)) = (&dbg_key, &outcome) {
                    let label = match out {
                        AppendApplyOutcome::Applied { .. } => "applied",
                        AppendApplyOutcome::ProducerDuplicate { .. } => "dup",
                        AppendApplyOutcome::NotFound => "notfound",
                        AppendApplyOutcome::ProducerGap { .. } => "GAP",
                        _ => "other",
                    };
                    let s: usize = path[path.len() - 3..].parse().unwrap_or(999);
                    self.nodes[i].trace.push((log_pos, s, *seq, label));
                    if label == "GAP" {
                        let lo = log_pos.saturating_sub(15);
                        for n in &self.nodes {
                            let win: Vec<_> =
                                n.trace.iter().filter(|t| t.0 >= lo).collect();
                            eprintln!("node {} applies from pos {lo}: {win:?}", n.id);
                        }
                        for n in &self.nodes {
                            let decided = n.op.get_decided_idx();
                            let hi = decided.min(log_pos + 8);
                            let raw: Vec<String> = n
                                .op
                                .read_entries(lo..hi)
                                .unwrap_or_default()
                                .iter()
                                .map(|le| match le {
                                    LogEntry::Decided(e) | LogEntry::Undecided(e) => {
                                        match &e.op {
                                            LogOp::Append { path, producer, .. } => format!(
                                                "{}:q{}",
                                                &path[path.len() - 1..],
                                                producer.as_ref().map(|p| p.seq).unwrap_or(0)
                                            ),
                                            LogOp::Create { path, .. } => format!("C{path}"),
                                            LogOp::Delete { path, .. } => format!("D{path}"),
                                        }
                                    }
                                    other => format!("{other:?}"),
                                })
                                .collect();
                            eprintln!(
                                "node {} decided={} compacted={} promise={:?} log[{lo}..{hi}]={raw:?}",
                                n.id,
                                decided,
                                n.op.get_compacted_idx(),
                                n.op.get_promise(),
                            );
                        }
                        panic!(
                            "GAP on node {} at log_pos {log_pos} stream {s} seq {seq}",
                            node_id
                        );
                    }
                }
                if e.origin == node_id {
                    if let Some(op_idx) = self.attempt_of.remove(&e.req_id) {
                        match outcome {
                            Some(
                                AppendApplyOutcome::Applied { .. }
                                | AppendApplyOutcome::ProducerDuplicate { .. },
                            ) => {
                                if !self.ops[op_idx].acked {
                                    self.ops[op_idx].acked = true;
                                    let s = self.ops[op_idx].stream;
                                    self.outstanding[s] = None;
                                }
                            }
                            Some(AppendApplyOutcome::NotFound) => {
                                // create not yet decided when this applied —
                                // retryable, like a client 404-retry.
                                self.rejected_attempts += 1;
                                self.ops[op_idx].attempts.remove(&e.req_id);
                                // force a fast retry
                                self.ops[op_idx].last_attempt_round = 0;
                            }
                            Some(other) => panic!(
                                "unexpected apply outcome for a well-formed producer append: {other:?}"
                            ),
                            None => {}
                        }
                    }
                }
            }
        }
        self.nodes[i].applied = decided;
        let compacted = self.nodes[i].op.get_compacted_idx();
        assert!(
            self.nodes[i].applied >= compacted,
            "applied cursor fell behind compaction on node {}",
            self.nodes[i].id
        );
    }

    /// Deliver one message to node `i`, honoring the production compaction
    /// guard: apply everything decided before handling a trim.
    fn handle(&mut self, i: usize, msg: Msg) {
        if self.nodes[i].crashed {
            return;
        }
        if super::core::is_compaction(&msg) {
            self.apply_decided(i);
        }
        self.nodes[i].op.handle_incoming(msg);
        self.apply_decided(i);
        self.pump(i);
    }

    fn propose_attempt(&mut self, op_idx: usize) {
        let live = self.live();
        let i = live[self.rng.below(live.len() as u64) as usize];
        let req_id = self.next_req;
        self.next_req += 1;
        let o = &mut self.ops[op_idx];
        o.attempts.insert(req_id);
        o.last_attempt_round = self.round;
        let entry = ReplEntry {
            origin: self.nodes[i].id,
            req_id,
            op: LogOp::Append {
                path: Self::stream_path(o.stream),
                wire: o.payload.clone().into_bytes(),
                producer: Some(ReplProducer {
                    id: format!("prod-{}", o.stream),
                    epoch: 0,
                    seq: o.seq,
                }),
                seq: None,
                close: false,
            },
        };
        self.attempt_of.insert(req_id, op_idx);
        let _ = self.nodes[i].op.append(entry);
        self.apply_decided(i); // single-node decides apply immediately-ish
        self.pump(i);
    }

    /// Propose an (idempotent) create for a stream from a random live node.
    fn propose_create(&mut self, s: usize) {
        let live = self.live();
        let i = live[self.rng.below(live.len() as u64) as usize];
        let req_id = self.next_req;
        self.next_req += 1;
        let entry = ReplEntry {
            origin: self.nodes[i].id,
            req_id,
            op: LogOp::Create {
                path: Self::stream_path(s),
                config: StreamConfig {
                    content_type: "application/octet-stream".into(),
                    ttl_seconds: None,
                    expires_at: None,
                    expires_at_raw: None,
                    create_closed: false,
                    forked_from: None,
                    fork_offset_raw: None,
                    fork_sub_offset: None,
                },
                base_offset: 0,
                wire: vec![],
            },
        };
        let _ = self.nodes[i].op.append(entry);
        self.pump(i);
    }

    fn new_client_op(&mut self, stream: usize) {
        let seq = self.next_seq[stream];
        self.next_seq[stream] += 1;
        let payload = format!("s{stream}:q{seq};");
        self.ops.push(ClientOp {
            stream,
            seq,
            payload,
            attempts: BTreeSet::new(),
            last_attempt_round: 0,
            acked: false,
        });
        let idx = self.ops.len() - 1;
        self.outstanding[stream] = Some(idx);
        self.propose_attempt(idx);
    }

    /// One randomized simulation round.
    fn step(&mut self, faults: bool) {
        self.round += 1;

        // Ticks: each live node, with jitter (drives elections + resends).
        for i in 0..self.nodes.len() {
            if !self.nodes[i].crashed && self.rng.chance(70) {
                self.nodes[i].op.tick();
                self.pump(i);
            }
        }

        // Client: start ops on idle streams (chaos phase only — quiescence
        // must converge) / retry stale ones.
        for s in 0..STREAMS {
            match self.outstanding[s] {
                None => {
                    if faults && self.rng.chance(30) {
                        self.new_client_op(s);
                    }
                }
                Some(idx) => {
                    if !self.ops[idx].acked
                        && self.round.saturating_sub(self.ops[idx].last_attempt_round)
                            > RETRY_ROUNDS
                    {
                        self.propose_attempt(idx);
                    }
                }
            }
        }

        // Creates are idempotent (Exists after the first apply): re-propose
        // any stream a live node hasn't materialized yet — the initial create
        // proposal can be lost like any forwarded proposal.
        if self.round % 50 == 0 {
            for s in 0..STREAMS {
                let missing = self
                    .live()
                    .iter()
                    .any(|&i| self.nodes[i].store.get(&Self::stream_path(s)).is_none());
                if missing {
                    self.propose_create(s);
                }
            }
        }

        // Faults.
        if faults {
            // One crash-stop per run (minority of 3), anywhere in the middle.
            if fault_enabled("CRASH")
                && self.crashes_done == 0
                && self.round > ROUNDS / 4
                && self.round < ROUNDS / 2
                && self.rng.chance(2)
            {
                let live = self.live();
                let i = live[self.rng.below(live.len() as u64) as usize];
                self.nodes[i].crashed = true;
                self.crashes_done = 1;
                // Messages in flight to/from a dead box are gone.
                let dead = self.nodes[i].id;
                for ((a, b), q) in self.links.iter_mut() {
                    if *a == dead || *b == dead {
                        q.clear();
                    }
                }
            }
            // Partition a random link for a window.
            if fault_enabled("PARTITION") && self.rng.chance(1) {
                let a = 1 + self.rng.below(N);
                let b = 1 + self.rng.below(N);
                if a != b {
                    let until = self.round + 20 + self.rng.below(60);
                    self.partitions.insert((a, b), until);
                    self.partitions.insert((b, a), until);
                }
            }
            self.partitions.retain(|_, until| *until > self.round);
        } else {
            self.partitions.clear();
        }

        // Trim, from whoever believes it is leader (production: trim ticker).
        if self.round % 97 == 0 {
            for i in self.live() {
                let _ = self.nodes[i].op.trim(None);
                self.pump(i);
            }
        }

        // Deliver a burst of messages from random links, with faults.
        let deliveries = 1 + self.rng.below(24);
        for _ in 0..deliveries {
            let keys: Vec<(u64, u64)> = self
                .links
                .iter()
                .filter(|(k, q)| {
                    !q.is_empty()
                        && !self.partitions.contains_key(k)
                        && !self.nodes[(k.1 - 1) as usize].crashed
                        && !self.nodes[(k.0 - 1) as usize].crashed
                })
                .map(|(k, _)| *k)
                .collect();
            if keys.is_empty() {
                break;
            }
            let k = keys[self.rng.below(keys.len() as u64) as usize];
            let msg = self.links.get_mut(&k).unwrap().pop_front().unwrap();
            if faults && fault_enabled("DROP") && self.rng.chance(DROP_PCT) {
                continue; // dropped on the wire (outbox overflow / reconnect)
            }
            let to = (k.1 - 1) as usize;
            self.handle(to, msg);
        }
    }
}

fn block_on<F: std::future::Future>(f: F) -> F::Output {
    // One shared current-thread runtime keeps the sim deterministic (applies
    // run to completion sequentially) while still supporting spawn_blocking.
    thread_local! {
        static RT: tokio::runtime::Runtime = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap();
    }
    RT.with(|rt| rt.block_on(f))
}

fn run_seed(seed: u64) {
    let mut sim = Sim::new("dst", seed);

    // Create the streams through the log — appends may race ahead of the
    // creates and get NotFound (client retries), and lost create proposals
    // are re-proposed periodically (idempotent).
    for s in 0..STREAMS {
        sim.propose_create(s);
    }

    // Chaos phase.
    for _ in 0..ROUNDS {
        sim.step(true);
    }

    // Quiescence: heal everything, keep ticking/delivering/retrying until all
    // ops ack and every live node has applied the full decided log. Bounded —
    // failure here is a LIVENESS bug (e.g. a proposal lost with no retry path).
    let mut quiesce = 0u64;
    loop {
        quiesce += 1;
        assert!(
            quiesce < 20_000,
            "seed {seed}: no quiescence — unacked ops: {:?}",
            sim.ops
                .iter()
                .filter(|o| !o.acked)
                .map(|o| (o.stream, o.seq))
                .collect::<Vec<_>>()
        );
        sim.step(false);
        let all_acked = sim.ops.iter().all(|o| o.acked);
        let drained: bool = sim
            .links
            .iter()
            .all(|(k, q)| q.is_empty() || sim.nodes[(k.1 - 1) as usize].crashed);
        let caught_up = sim
            .live()
            .iter()
            .all(|&i| sim.nodes[i].applied == sim.nodes[i].op.get_decided_idx());
        if all_acked && drained && caught_up {
            break;
        }
    }

    // I4: compaction must have been active during the run.
    assert!(
        sim.live()
            .iter()
            .any(|&i| sim.nodes[i].op.get_compacted_idx() > 0),
        "seed {seed}: the log never trimmed — invariants not exercised under compaction"
    );

    // I1 + I2: every live node's stream content is exactly the in-seq
    // concatenation of acked payloads, and identical across nodes.
    for s in 0..STREAMS {
        let path = Sim::stream_path(s);
        let mut expected = String::new();
        let mut acked: Vec<&ClientOp> =
            sim.ops.iter().filter(|o| o.stream == s && o.acked).collect();
        acked.sort_by_key(|o| o.seq);
        for (i, o) in acked.iter().enumerate() {
            assert_eq!(o.seq as usize, i, "seed {seed}: acked seqs not contiguous");
            expected.push_str(&o.payload);
        }
        for &i in &sim.live() {
            let st = sim.nodes[i].store.get(&path).unwrap_or_else(|| {
                panic!("seed {seed}: node {} is missing stream {path}", sim.nodes[i].id)
            });
            let tail = st.tail().bytes;
            assert_eq!(
                tail,
                expected.len() as u64,
                "seed {seed}: node {} tail mismatch on {path}",
                sim.nodes[i].id
            );
            let bytes =
                block_on(crate::handlers::read_range_bytes(&st, 0, tail)).unwrap_or_default();
            assert_eq!(
                std::str::from_utf8(&bytes).unwrap(),
                expected,
                "seed {seed}: node {} content mismatch on {path}",
                sim.nodes[i].id
            );
        }
    }
}

#[test]
fn replication_dst_randomized() {
    let seeds: u64 = std::env::var("DS_REPL_SIM_SEEDS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(10);
    let seed0: u64 = std::env::var("DS_REPL_SIM_SEED0")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0xD5_BE_11C4);
    for k in 0..seeds {
        let seed = seed0.wrapping_add(k);
        run_seed(seed);
    }
}
