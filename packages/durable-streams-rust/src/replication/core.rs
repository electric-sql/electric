//! The replication handle: proposes ops through openraft and returns the
//! state-machine apply outcome as the ack (log-first apply — REPLICATION.md).
//!
//! `Raft::client_write` resolves with the outcome the state machine computed
//! when it applied the entry, so there is no hand-rolled pending-ack map. On
//! a non-leader node the proposal is forwarded to the leader over the RPC
//! mesh; the origin then waits until its OWN applied index covers the entry,
//! preserving read-your-writes on the node that took the HTTP request.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use super::entry::{LogOp, OpOutcome};
use super::log_store::LogStore;
use super::net::{RpcClient, RpcReply, RpcRequest};
use super::sm::StateMachine;
use super::types::{typ, NodeId, Raft, TypeConfig};

/// Propose failed to produce an outcome within the ack timeout (no leader,
/// dropped forward, or a stalled quorum). Safe to retry — producer dedup
/// absorbs a duplicate that did land.
#[derive(Debug)]
pub struct AckTimeout;

pub struct ReplHandle {
    pub node_id: NodeId,
    pub raft: Raft,
    pub(super) sm: Arc<StateMachine>,
    pub(super) log_store: LogStore<TypeConfig>,
    pub(super) clients: HashMap<NodeId, Arc<RpcClient>>,
    ack_timeout: Duration,
    /// Ops proposed by THIS node (cumulative).
    pub proposed: AtomicU64,
    /// Proposals forwarded to a remote leader (cumulative).
    pub forwarded: AtomicU64,
    /// Proposals that failed to resolve within the ack timeout (cumulative).
    pub timeouts: AtomicU64,
}

impl ReplHandle {
    pub(super) fn new(
        node_id: NodeId,
        raft: Raft,
        sm: Arc<StateMachine>,
        log_store: LogStore<TypeConfig>,
        clients: HashMap<NodeId, Arc<RpcClient>>,
        ack_timeout: Duration,
    ) -> Arc<Self> {
        Arc::new(ReplHandle {
            node_id,
            raft,
            sm,
            log_store,
            clients,
            ack_timeout,
            proposed: AtomicU64::new(0),
            forwarded: AtomicU64::new(0),
            timeouts: AtomicU64::new(0),
        })
    }

    pub async fn propose_and_wait(&self, op: LogOp) -> Result<OpOutcome, AckTimeout> {
        self.proposed.fetch_add(1, Ordering::Relaxed);
        let write = self.raft.client_write(op.clone());
        match tokio::time::timeout(self.ack_timeout, write).await {
            Ok(Ok(resp)) => Ok(resp.data),
            Ok(Err(typ::RaftError::APIError(typ::ClientWriteError::ForwardToLeader(fw)))) => {
                self.forward_to_leader(op, fw.leader_id).await
            }
            _ => {
                self.timeouts.fetch_add(1, Ordering::Relaxed);
                Err(AckTimeout)
            }
        }
    }

    async fn forward_to_leader(
        &self,
        op: LogOp,
        leader: Option<NodeId>,
    ) -> Result<OpOutcome, AckTimeout> {
        let Some(leader) = leader else {
            // No known leader (election in progress) — the client retries.
            self.timeouts.fetch_add(1, Ordering::Relaxed);
            return Err(AckTimeout);
        };
        let Some(client) = self.clients.get(&leader) else {
            self.timeouts.fetch_add(1, Ordering::Relaxed);
            return Err(AckTimeout);
        };
        self.forwarded.fetch_add(1, Ordering::Relaxed);
        let call = client.call(RpcRequest::Forward(op));
        match tokio::time::timeout(self.ack_timeout, call).await {
            Ok(Ok(RpcReply::Forward(Ok((outcome, log_index))))) => {
                // Read-your-writes on THIS node: wait until the local state
                // machine has applied at least the acked entry.
                let _ = self
                    .raft
                    .wait(Some(self.ack_timeout))
                    .metrics(
                        move |m| {
                            m.last_applied.map(|l| l.index >= log_index).unwrap_or(false)
                        },
                        "local apply of forwarded write",
                    )
                    .await;
                Ok(outcome)
            }
            _ => {
                self.timeouts.fetch_add(1, Ordering::Relaxed);
                Err(AckTimeout)
            }
        }
    }

    pub fn status_json(&self) -> String {
        let m = self.raft.metrics().borrow().clone();
        let mut peers: Vec<String> = self
            .clients
            .iter()
            .filter(|(_, c)| c.connected.load(Ordering::Relaxed))
            .map(|(id, _)| id.to_string())
            .collect();
        peers.sort();
        let applied = m.last_applied.map(|l| l.index).unwrap_or(0);
        let last_log = m.last_log_index.unwrap_or(0);
        let purged = m.purged.map(|l| l.index).unwrap_or(0);
        format!(
            "{{\"id\":{},\"leader\":{},\"decided_idx\":{},\"log_window\":{},\"pending\":{},\"timeouts\":{},\"connected_peers\":[{}]}}",
            self.node_id,
            m.current_leader.map(|l| l.to_string()).unwrap_or_else(|| "null".to_string()),
            applied,
            last_log.saturating_sub(purged),
            last_log.saturating_sub(applied),
            self.timeouts.load(Ordering::Relaxed),
            peers.join(",")
        )
    }
}

/// `--repl-stats N`: every N seconds print a one-line `REPL_STATS` snapshot
/// to stderr — same shape as the omnipaxos incarnation so the monitoring
/// tooling and mental models carry over.
pub(super) fn spawn_stats_emitter(handle: Arc<ReplHandle>, every: Duration) {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(every);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        tick.tick().await;
        let (mut p0, mut a0, mut f0) = (0u64, 0u64, 0u64);
        loop {
            tick.tick().await;
            let m = handle.raft.metrics().borrow().clone();
            let p = handle.proposed.load(Ordering::Relaxed);
            let f = handle.forwarded.load(Ordering::Relaxed);
            let a = handle
                .sm
                .applied_ops
                .load(std::sync::atomic::Ordering::Relaxed);
            let (window, _) = handle.log_store.window().await;
            let secs = every.as_secs_f64();
            eprintln!(
                "REPL_STATS node={} leader={} proposed/s={:.0} forwarded/s={:.0} applied/s={:.0} window={} applied_idx={} timeouts={} apply_max_us={}",
                handle.node_id,
                m.current_leader.unwrap_or(0),
                (p - p0) as f64 / secs,
                (f - f0) as f64 / secs,
                (a - a0) as f64 / secs,
                window,
                m.last_applied.map(|l| l.index).unwrap_or(0),
                handle.timeouts.load(Ordering::Relaxed),
                handle
                    .sm
                    .apply_max_us
                    .swap(0, std::sync::atomic::Ordering::Relaxed),
            );
            (p0, a0, f0) = (p, a, f);
        }
    });
}
