//! The consensus core: one OmniPaxos instance in a dedicated task, driven by
//! ticks, incoming peer messages, and local proposals. Decided entries are
//! applied to the store in log order (log-first apply — REPLICATION.md) and
//! acks are resolved on the proposing node.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use omnipaxos::util::{LogEntry, NodeId};
use omnipaxos::{ClusterConfig, OmniPaxos, OmniPaxosConfig, ServerConfig};
use tokio::sync::{mpsc, oneshot};

use super::entry::{LogOp, OpOutcome, ReplEntry};
use super::mem_storage::MemStorage;
use super::net::Mesh;
use super::ReplConfig;
use crate::store::Store;

/// 10 ms logical tick; ×50 = 500 ms election timeout, ×100 = 1 s resend.
const TICK: Duration = Duration::from_millis(10);
const ELECTION_TICKS: u64 = 50;
const RESEND_TICKS: u64 = 100;
/// Handler→core proposal queue. Bounded so a decide stall backpressures
/// appenders instead of ballooning memory.
const PROPOSAL_DEPTH: usize = 8192;
const INCOMING_DEPTH: usize = 65536;
/// Decided entries are applied by a small pool of shard tasks (stream path →
/// shard, so per-stream log order is preserved). Sharding keeps one slow store
/// write — a page-cache stall, an APFS journal flush — from stalling consensus
/// and every other stream's ack, which measured as 100–450 ms apply_max_us
/// tails when applies ran inline in the core task.
const APPLY_SHARDS: usize = 4;
const APPLY_QUEUE_DEPTH: usize = 4096;
/// Dirty meta sidecars are swept per shard on this cadence, replacing the
/// per-append 100 ms-debounced rewrite (200 streams × 10 renames/s × N nodes
/// was enough fs-journal churn to cause the stalls above).
const META_SWEEP: Duration = Duration::from_secs(3);

type Op = OmniPaxos<ReplEntry, MemStorage<ReplEntry>>;

/// Shared handle the HTTP handlers use to propose ops and await their apply
/// outcome, plus status gauges for `/_repl/status`.
pub struct ReplHandle {
    pub node_id: NodeId,
    proposal_tx: mpsc::Sender<ReplEntry>,
    pending: Mutex<HashMap<u64, oneshot::Sender<OpOutcome>>>,
    next_req: AtomicU64,
    ack_timeout: Duration,
    /// Current leader pid (0 = none elected yet).
    pub leader: AtomicU64,
    /// Decided (= applied) log index.
    pub decided: AtomicU64,
    /// Compacted (trimmed) log index — `decided - compacted` is the in-memory
    /// log window the trim loop is supposed to keep bounded.
    pub compacted: AtomicU64,
    /// Ops proposed by THIS node (cumulative).
    pub proposed: AtomicU64,
    /// Decided ops applied locally (cumulative; includes other nodes' ops).
    pub applied: AtomicU64,
    /// Proposals that timed out waiting for their apply outcome (cumulative).
    pub timeouts: AtomicU64,
    /// Slowest single apply observed since the last stats emit, in µs. A large
    /// value with idle CPU fingers a blocking store write stalling the applier.
    pub apply_max_us: AtomicU64,
    /// Outbound link state per peer.
    connected: HashMap<NodeId, Arc<std::sync::atomic::AtomicBool>>,
}

/// Propose failed to produce an outcome within the ack timeout (e.g. a
/// forwarded proposal was dropped by a leader change). Safe to retry —
/// producer dedup absorbs a duplicate that did decide.
#[derive(Debug)]
pub struct AckTimeout;

impl ReplHandle {
    pub async fn propose_and_wait(&self, op: LogOp) -> Result<OpOutcome, AckTimeout> {
        let req_id = self.next_req.fetch_add(1, Ordering::Relaxed);
        self.proposed.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(req_id, tx);
        let entry = ReplEntry {
            origin: self.node_id,
            req_id,
            op,
        };
        if self.proposal_tx.send(entry).await.is_err() {
            self.pending.lock().unwrap().remove(&req_id);
            self.timeouts.fetch_add(1, Ordering::Relaxed);
            return Err(AckTimeout);
        }
        match tokio::time::timeout(self.ack_timeout, rx).await {
            Ok(Ok(outcome)) => Ok(outcome),
            _ => {
                self.pending.lock().unwrap().remove(&req_id);
                self.timeouts.fetch_add(1, Ordering::Relaxed);
                Err(AckTimeout)
            }
        }
    }

    pub fn pending_len(&self) -> usize {
        self.pending.lock().unwrap().len()
    }

    pub fn status_json(&self) -> String {
        let mut peers: Vec<String> = self
            .connected
            .iter()
            .filter(|(_, up)| up.load(Ordering::Relaxed))
            .map(|(id, _)| id.to_string())
            .collect();
        peers.sort();
        let leader = self.leader.load(Ordering::Relaxed);
        let decided = self.decided.load(Ordering::Relaxed);
        let compacted = self.compacted.load(Ordering::Relaxed);
        format!(
            "{{\"id\":{},\"leader\":{},\"decided_idx\":{},\"log_window\":{},\"pending\":{},\"timeouts\":{},\"connected_peers\":[{}]}}",
            self.node_id,
            if leader == 0 {
                "null".to_string()
            } else {
                leader.to_string()
            },
            decided,
            decided.saturating_sub(compacted),
            self.pending_len(),
            self.timeouts.load(Ordering::Relaxed),
            peers.join(",")
        )
    }
}

/// `--repl-stats N`: every N seconds print a one-line `REPL_STATS` snapshot to
/// stderr — per-interval proposal/apply rates, the log window (decided −
/// compacted; flat ⇒ trim is keeping up), pending acks, and timeouts. Zero
/// cost on the hot path (reads the gauges the core already maintains).
pub(super) fn spawn_stats_emitter(handle: Arc<ReplHandle>, every: Duration) {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(every);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        tick.tick().await; // skip the immediate first fire
        let (mut p0, mut a0, mut d0) = (0u64, 0u64, 0u64);
        loop {
            tick.tick().await;
            let p = handle.proposed.load(Ordering::Relaxed);
            let a = handle.applied.load(Ordering::Relaxed);
            let d = handle.decided.load(Ordering::Relaxed);
            let c = handle.compacted.load(Ordering::Relaxed);
            let secs = every.as_secs_f64();
            eprintln!(
                "REPL_STATS node={} leader={} proposed/s={:.0} decided/s={:.0} applied/s={:.0} window={} pending={} timeouts={} apply_max_us={}",
                handle.node_id,
                handle.leader.load(Ordering::Relaxed),
                (p - p0) as f64 / secs,
                (d - d0) as f64 / secs,
                (a - a0) as f64 / secs,
                d.saturating_sub(c),
                handle.pending_len(),
                handle.timeouts.load(Ordering::Relaxed),
                handle.apply_max_us.swap(0, Ordering::Relaxed),
            );
            (p0, a0, d0) = (p, a, d);
        }
    });
}

/// Build the OmniPaxos instance, spawn the core loop, and return the handle.
pub(super) fn spawn_core(
    store: Arc<Store>,
    cfg: &ReplConfig,
    mesh: Mesh,
    incoming_rx: mpsc::Receiver<omnipaxos::messages::Message<ReplEntry>>,
) -> Arc<ReplHandle> {
    let op_cfg = OmniPaxosConfig {
        cluster_config: ClusterConfig {
            configuration_id: 1,
            nodes: cfg.peers.iter().map(|(id, _)| *id).collect(),
            flexible_quorum: None,
        },
        server_config: ServerConfig {
            pid: cfg.id,
            election_tick_timeout: ELECTION_TICKS,
            resend_message_tick_timeout: RESEND_TICKS,
            ..Default::default()
        },
    };
    let op: Op = op_cfg
        .build(MemStorage::default())
        .expect("invalid replication config");

    let (proposal_tx, proposal_rx) = mpsc::channel(PROPOSAL_DEPTH);
    let handle = Arc::new(ReplHandle {
        node_id: cfg.id,
        proposal_tx,
        pending: Mutex::new(HashMap::new()),
        next_req: AtomicU64::new(1),
        ack_timeout: cfg.ack_timeout,
        leader: AtomicU64::new(0),
        decided: AtomicU64::new(0),
        compacted: AtomicU64::new(0),
        proposed: AtomicU64::new(0),
        applied: AtomicU64::new(0),
        timeouts: AtomicU64::new(0),
        apply_max_us: AtomicU64::new(0),
        connected: mesh.connected.clone(),
    });
    let appliers = spawn_appliers(&store, &handle);
    tokio::spawn(run(
        store,
        op,
        mesh,
        proposal_rx,
        incoming_rx,
        Arc::clone(&handle),
        appliers,
        cfg.trim_secs,
    ));
    handle
}

pub(super) fn incoming_channel() -> (
    mpsc::Sender<omnipaxos::messages::Message<ReplEntry>>,
    mpsc::Receiver<omnipaxos::messages::Message<ReplEntry>>,
) {
    mpsc::channel(INCOMING_DEPTH)
}

async fn run(
    store: Arc<Store>,
    mut op: Op,
    mesh: Mesh,
    mut proposal_rx: mpsc::Receiver<ReplEntry>,
    mut incoming_rx: mpsc::Receiver<omnipaxos::messages::Message<ReplEntry>>,
    handle: Arc<ReplHandle>,
    appliers: Vec<mpsc::Sender<ShardMsg>>,
    trim_secs: u64,
) {
    let mut tick = tokio::time::interval(TICK);
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut trim = tokio::time::interval(Duration::from_secs(trim_secs.max(1)));
    trim.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let trim_enabled = trim_secs > 0;
    // The applied cursor: everything below is already folded into the store.
    let mut applied: usize = 0;
    // Reused outgoing-message buffer (upstream API takes a buffer to fill).
    let mut out_buf: Vec<omnipaxos::messages::Message<ReplEntry>> = Vec::new();

    loop {
        tokio::select! {
            _ = tick.tick() => op.tick(),
            _ = trim.tick(), if trim_enabled => {
                // Trims the prefix decided by ALL nodes; errs (and no-ops) while
                // a peer lags/is down — memory grows until it returns (documented).
                let _ = op.trim(None);
            }
            entry = proposal_rx.recv() => {
                let Some(entry) = entry else { return }; // shutdown
                // Opportunistically drain the queue: batch_accept folds all
                // outstanding proposals into one Accept round (group commit).
                let mut batch = vec![entry];
                while let Ok(e) = proposal_rx.try_recv() {
                    batch.push(e);
                }
                for e in batch {
                    // Errs only while a reconfiguration is pending (we never
                    // reconfigure in v1); the pending ack then times out → 503.
                    let _ = op.append(e);
                }
            }
            msg = incoming_rx.recv() => {
                let Some(msg) = msg else { return };
                // TRIM-VS-APPLY RACE GUARD: a Compaction(Trim) only checks
                // omnipaxos's own decided_idx (its try_trim), NOT our applied
                // cursor. If a drained batch contains Decide(N) followed by
                // Trim(N), handling both before applying would delete
                // decided-but-unapplied entries — silent replica divergence
                // plus leaked acks. Flush the applier before any compaction.
                if is_compaction(&msg) {
                    dispatch_new_decided(&mut op, &store, &handle, &appliers, &mut applied).await;
                }
                op.handle_incoming(msg);
                while let Ok(m) = incoming_rx.try_recv() {
                    if is_compaction(&m) {
                        dispatch_new_decided(&mut op, &store, &handle, &appliers, &mut applied)
                            .await;
                    }
                    op.handle_incoming(m);
                }
            }
        }

        // Hand anything newly decided to the shard appliers, in log order.
        dispatch_new_decided(&mut op, &store, &handle, &appliers, &mut applied).await;
        handle
            .compacted
            .store(op.get_compacted_idx() as u64, Ordering::Relaxed);
        handle.leader.store(
            op.get_current_leader().map(|(pid, _)| pid).unwrap_or(0),
            Ordering::Relaxed,
        );

        op.take_outgoing_messages(&mut out_buf);
        for msg in out_buf.drain(..) {
            mesh.send(msg);
        }
    }
}

/// True for messages that can compact (trim) the log — see the race guard in
/// `run()`. pub(super): the DST harness replicates the same guard.
pub(super) fn is_compaction(msg: &omnipaxos::messages::Message<ReplEntry>) -> bool {
    use omnipaxos::messages::sequence_paxos::PaxosMsg;
    use omnipaxos::messages::Message;
    matches!(
        msg,
        Message::SequencePaxos(pm) if matches!(pm.msg, PaxosMsg::Compaction(_))
    )
}

// ---------- sharded appliers ----------

enum ShardMsg {
    Op(ReplEntry),
    /// Drain barrier: acked once every prior op in this shard has applied.
    Flush(oneshot::Sender<()>),
}

fn op_path(op: &LogOp) -> &str {
    match op {
        LogOp::Create { path, .. } | LogOp::Append { path, .. } | LogOp::Delete { path } => path,
    }
}

fn shard_for(path: &str) -> usize {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut h);
    (h.finish() as usize) % APPLY_SHARDS
}

/// Fork creates read the parent stream's state at apply time, and the parent
/// may hash to a different shard — they are applied inline behind a full
/// drain barrier instead (cold control op; correctness over speed).
fn is_fork_create(op: &LogOp) -> bool {
    matches!(op, LogOp::Create { config, .. } if config.forked_from.is_some())
}

fn spawn_appliers(store: &Arc<Store>, handle: &Arc<ReplHandle>) -> Vec<mpsc::Sender<ShardMsg>> {
    (0..APPLY_SHARDS)
        .map(|_| {
            let (tx, mut rx) = mpsc::channel::<ShardMsg>(APPLY_QUEUE_DEPTH);
            let store = Arc::clone(store);
            let handle = Arc::clone(handle);
            tokio::spawn(async move {
                // Streams touched since the last sweep; their meta sidecars are
                // rewritten (non-durably) in bulk instead of per append.
                let mut dirty: HashMap<u64, Arc<crate::store::StreamState>> = HashMap::new();
                let mut sweep = tokio::time::interval(META_SWEEP);
                sweep.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                loop {
                    tokio::select! {
                        msg = rx.recv() => {
                            match msg {
                                None => break, // core gone (shutdown)
                                Some(ShardMsg::Op(e)) => {
                                    apply_and_resolve(&store, &handle, e, &mut dirty).await;
                                }
                                Some(ShardMsg::Flush(ack)) => {
                                    let _ = ack.send(());
                                }
                            }
                        }
                        _ = sweep.tick() => flush_dirty_meta(&mut dirty),
                    }
                }
                flush_dirty_meta(&mut dirty);
            });
            tx
        })
        .collect()
}

/// Rewrite the meta sidecars of every stream touched since the last sweep.
/// Detached onto the blocking pool: sweeps must not stall the shard's applies.
fn flush_dirty_meta(dirty: &mut HashMap<u64, Arc<crate::store::StreamState>>) {
    for (_, st) in dirty.drain() {
        tokio::task::spawn_blocking(move || {
            let _ = crate::store::write_meta_sync(&st, false);
        });
    }
}

/// Apply one decided entry, record telemetry, resolve the pending ack if this
/// node proposed it, and mark the touched stream's meta dirty.
async fn apply_and_resolve(
    store: &Arc<Store>,
    handle: &Arc<ReplHandle>,
    e: ReplEntry,
    dirty: &mut HashMap<u64, Arc<crate::store::StreamState>>,
) {
    let path = op_path(&e.op).to_string();
    let t0 = std::time::Instant::now();
    let outcome = apply(store, e.op).await;
    let us = t0.elapsed().as_micros() as u64;
    handle.apply_max_us.fetch_max(us, Ordering::Relaxed);
    handle.applied.fetch_add(1, Ordering::Relaxed);
    let mutated = matches!(
        outcome,
        OpOutcome::Append(crate::replication::entry::AppendApplyOutcome::Applied { .. })
            | OpOutcome::Create(crate::replication::entry::CreateApplyOutcome::Created { .. })
    );
    if mutated {
        if let Some(st) = store.get(&path) {
            dirty.entry(st.id).or_insert(st);
        }
    }
    if e.origin == handle.node_id {
        let tx = handle.pending.lock().unwrap().remove(&e.req_id);
        if let Some(tx) = tx {
            let _ = tx.send(outcome);
        }
    }
}

/// Hand every decided-but-undispatched entry to its shard applier, in log
/// order (per-stream order is preserved by path→shard hashing). Entries are
/// CLONED out of the omnipaxos log here, which is what makes the later trim
/// safe. MUST run before any compaction is handled (see the guard in `run()`).
async fn dispatch_new_decided(
    op: &mut Op,
    store: &Arc<Store>,
    handle: &Arc<ReplHandle>,
    appliers: &[mpsc::Sender<ShardMsg>],
    applied: &mut usize,
) {
    let decided_idx = op.get_decided_idx();
    if decided_idx > *applied {
        if let Some(entries) = op.read_decided_suffix(*applied) {
            for le in entries {
                if let LogEntry::Decided(e) = le {
                    if is_fork_create(&e.op) {
                        // Barrier: the parent's prior ops may be queued on any
                        // shard; drain them all, then apply the fork inline.
                        for tx in appliers {
                            let (ack_tx, ack_rx) = oneshot::channel();
                            if tx.send(ShardMsg::Flush(ack_tx)).await.is_ok() {
                                let _ = ack_rx.await;
                            }
                        }
                        let mut tmp = HashMap::new();
                        apply_and_resolve(store, handle, e, &mut tmp).await;
                        flush_dirty_meta(&mut tmp);
                    } else {
                        let shard = shard_for(op_path(&e.op));
                        // Backpressure: a full shard queue blocks dispatch (and
                        // thus consensus applies) rather than growing unbounded.
                        let _ = appliers[shard].send(ShardMsg::Op(e)).await;
                    }
                }
            }
        }
        *applied = decided_idx;
        handle.decided.store(decided_idx as u64, Ordering::Relaxed);
    }
}

/// Fold one decided op into the local store. The semantic twins of the
/// single-node handlers live in `handlers.rs` (`apply_replicated_*`) so the
/// check/mutate logic stays next to the code it mirrors.
async fn apply(store: &Arc<Store>, op: LogOp) -> OpOutcome {
    match op {
        LogOp::Create {
            path,
            config,
            base_offset,
            wire,
        } => OpOutcome::Create(
            crate::handlers::apply_replicated_create(store, &path, config, base_offset, wire)
                .await,
        ),
        LogOp::Append {
            path,
            wire,
            producer,
            seq,
            close,
        } => OpOutcome::Append(
            crate::handlers::apply_replicated_append(store, &path, wire, producer, seq, close)
                .await,
        ),
        LogOp::Delete { path } => {
            OpOutcome::Delete(crate::handlers::apply_replicated_delete(store, &path).await)
        }
    }
}
