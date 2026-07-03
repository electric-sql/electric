//! Raft-replicated durability (`--durability replicated`) — see REPLICATION.md.
//!
//! Layering:
//! - `entry`     — what goes through the log (`LogOp`) and apply outcomes
//! - `types`     — openraft type wiring (D = LogOp, R = OpOutcome)
//! - `log_store` — in-memory Raft log + vote (vendored reference impl)
//! - `sm`        — the state machine: sharded log-first apply into the Store
//! - `net`       — RPC mesh (openraft RPCs + forward-to-leader proposals)
//! - `core`      — ReplHandle: propose/ack, status, stats
//! - the semantic apply functions (`apply_replicated_*`) live in `handlers.rs`,
//!   next to their single-node twins
//!
//! `main.rs` calls `start()` then `install()`; the HTTP handlers reach the
//! running instance through `handle()`.

pub mod core;
pub mod entry;
mod log_store;
mod net;
mod sm;
pub mod types;

#[cfg(test)]
mod tests;

use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

pub use core::{AckTimeout, ReplHandle};
use openraft::BasicNode;

use crate::store::Store;

/// Replication settings, parsed from `--repl-*` flags (see REPLICATION.md
/// "Configuration").
#[derive(Clone, Debug)]
pub struct ReplConfig {
    /// This node's id (must appear in `peers`).
    pub id: u64,
    /// Full membership, `(id, host:port)` of every node's replication listener
    /// — including this node (that entry provides our default listen port).
    pub peers: Vec<(u64, String)>,
    /// Peer-listener bind address.
    pub listen: String,
    /// How long `propose_and_wait` waits for the acked outcome before 503.
    pub ack_timeout: Duration,
    /// Snapshot (log-purge) cadence in log entries: a marker snapshot is
    /// taken every N entries and the log behind it is purged, bounding the
    /// in-memory log to roughly N + keep-margin entries per node.
    pub snapshot_logs: u64,
    /// `REPL_STATS` stderr emit cadence in seconds (0 = off).
    pub stats_secs: u64,
}

impl ReplConfig {
    /// Parse `1@host:port,2@host:port,…` (the `--repl-peers` value).
    pub fn parse_peers(s: &str) -> Result<Vec<(u64, String)>, String> {
        let mut peers = Vec::new();
        for part in s.split(',') {
            let (id, addr) = part
                .split_once('@')
                .ok_or_else(|| format!("bad peer {part:?}: want id@host:port"))?;
            let id: u64 = id
                .parse()
                .map_err(|_| format!("bad peer id in {part:?}"))?;
            if id == 0 {
                return Err("peer ids are 1-based (0 is reserved)".into());
            }
            if addr.rsplit_once(':').is_none() {
                return Err(format!("bad peer address {addr:?}: want host:port"));
            }
            peers.push((id, addr.to_string()));
        }
        if peers.len() < 2 {
            return Err("--repl-peers needs at least 2 nodes".into());
        }
        Ok(peers)
    }

    /// The default listen address: `0.0.0.0:<port from our own peers entry>`.
    pub fn default_listen(&self) -> Result<String, String> {
        let (_, addr) = self
            .peers
            .iter()
            .find(|(id, _)| *id == self.id)
            .ok_or_else(|| format!("--repl-id {} not present in --repl-peers", self.id))?;
        let (_, port) = addr.rsplit_once(':').expect("validated in parse_peers");
        Ok(format!("0.0.0.0:{port}"))
    }
}

/// Bind the peer listener and start the Raft node. Separated from `install()`
/// so tests can run several nodes in one process.
pub async fn start(store: Arc<Store>, cfg: &ReplConfig) -> std::io::Result<Arc<ReplHandle>> {
    let listener = tokio::net::TcpListener::bind(&cfg.listen).await?;
    Ok(start_with_listener(store, cfg, listener).await)
}

pub async fn start_with_listener(
    store: Arc<Store>,
    cfg: &ReplConfig,
    listener: tokio::net::TcpListener,
) -> Arc<ReplHandle> {
    // Election/heartbeat sized to match the omnipaxos incarnation (~500 ms
    // fail-over) so the comparison and the documented behavior carry over.
    let config = openraft::Config {
        heartbeat_interval: 100,
        election_timeout_min: 500,
        election_timeout_max: 1000,
        snapshot_policy: openraft::SnapshotPolicy::LogsSinceLast(cfg.snapshot_logs.max(1)),
        max_in_snapshot_log_to_keep: 256,
        ..Default::default()
    };
    let config = Arc::new(config.validate().expect("invalid raft config"));

    let log_store = log_store::LogStore::<types::TypeConfig>::default();
    let sm = sm::StateMachine::new(Arc::clone(&store));
    sm.spawn_meta_sweeper();

    let clients: HashMap<u64, Arc<net::RpcClient>> = cfg
        .peers
        .iter()
        .filter(|(id, _)| *id != cfg.id)
        .map(|(id, addr)| (*id, net::RpcClient::new(addr.clone())))
        .collect();

    let raft = types::Raft::new(
        cfg.id,
        config,
        net::MeshFactory {
            clients: clients.clone(),
        },
        log_store.clone(),
        Arc::clone(&sm),
    )
    .await
    .expect("failed to start raft");

    net::spawn_server(listener, raft.clone());

    // Bootstrap: every node proposes the same initial membership; on an
    // already-initialized node this errs (NotAllowed) and is ignored.
    let members: BTreeMap<u64, BasicNode> = cfg
        .peers
        .iter()
        .map(|(id, addr)| (*id, BasicNode::new(addr.clone())))
        .collect();
    let _ = raft.initialize(members).await;

    let handle = ReplHandle::new(cfg.id, raft, sm, log_store, clients, cfg.ack_timeout);
    if cfg.stats_secs > 0 {
        core::spawn_stats_emitter(
            Arc::clone(&handle),
            std::time::Duration::from_secs(cfg.stats_secs),
        );
    }
    handle
}

// The process-wide instance the HTTP handlers use. Set once by main; tests
// drive their multi-node clusters through the returned handles instead.
static HANDLE: OnceLock<Arc<ReplHandle>> = OnceLock::new();

pub fn install(h: Arc<ReplHandle>) {
    HANDLE.set(h).ok().expect("replication already installed");
}

pub fn handle() -> &'static Arc<ReplHandle> {
    HANDLE.get().expect("replication not started")
}
