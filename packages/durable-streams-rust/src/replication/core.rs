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
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(req_id, tx);
        let entry = ReplEntry {
            origin: self.node_id,
            req_id,
            op,
        };
        if self.proposal_tx.send(entry).await.is_err() {
            self.pending.lock().unwrap().remove(&req_id);
            return Err(AckTimeout);
        }
        match tokio::time::timeout(self.ack_timeout, rx).await {
            Ok(Ok(outcome)) => Ok(outcome),
            _ => {
                self.pending.lock().unwrap().remove(&req_id);
                Err(AckTimeout)
            }
        }
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
        format!(
            "{{\"id\":{},\"leader\":{},\"decided_idx\":{},\"connected_peers\":[{}]}}",
            self.node_id,
            if leader == 0 {
                "null".to_string()
            } else {
                leader.to_string()
            },
            self.decided.load(Ordering::Relaxed),
            peers.join(",")
        )
    }
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
        connected: mesh.connected.clone(),
    });
    tokio::spawn(run(
        store,
        op,
        mesh,
        proposal_rx,
        incoming_rx,
        Arc::clone(&handle),
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
    trim_secs: u64,
) {
    let mut tick = tokio::time::interval(TICK);
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut trim = tokio::time::interval(Duration::from_secs(trim_secs.max(1)));
    trim.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let trim_enabled = trim_secs > 0;
    // The applied cursor: everything below is already folded into the store.
    let mut applied: u64 = 0;

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
                op.handle_incoming(msg);
                while let Ok(m) = incoming_rx.try_recv() {
                    op.handle_incoming(m);
                }
            }
        }

        // Apply anything newly decided, in log order, on every node.
        let decided_idx = op.get_decided_idx();
        if decided_idx > applied {
            if let Some(entries) = op.read_decided_suffix(applied) {
                for le in entries {
                    if let LogEntry::Decided(e) = le {
                        let outcome = apply(&store, e.op).await;
                        if e.origin == handle.node_id {
                            let tx = handle.pending.lock().unwrap().remove(&e.req_id);
                            if let Some(tx) = tx {
                                let _ = tx.send(outcome);
                            }
                        }
                    }
                }
            }
            applied = decided_idx;
            handle.decided.store(decided_idx, Ordering::Relaxed);
        }
        handle
            .leader
            .store(op.get_current_leader().unwrap_or(0), Ordering::Relaxed);

        for msg in op.outgoing_messages() {
            mesh.send(msg);
        }
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
