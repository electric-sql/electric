//! Paxos-replicated durability (`--durability replicated`) — see REPLICATION.md.
//!
//! Layering:
//! - `entry`   — what goes through the log (`LogOp`) and apply outcomes
//! - `net`     — TCP mesh between replicas (length-prefixed bincode frames)
//! - `core`    — the OmniPaxos instance + event loop + decided-entry applier
//! - the semantic apply functions (`apply_replicated_*`) live in `handlers.rs`,
//!   next to their single-node twins
//!
//! `main.rs` calls `start()` then `install()`; the HTTP handlers reach the
//! running instance through `handle()`.

pub mod core;
pub mod entry;
mod mem_storage;
mod net;
#[cfg(test)]
mod tests;

use std::sync::{Arc, OnceLock};
use std::time::Duration;

pub use core::ReplHandle;

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
    /// How long `propose_and_wait` waits for the decided outcome before 503.
    pub ack_timeout: Duration,
    /// Log-trim cadence in seconds (0 = never trim).
    pub trim_secs: u64,
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

/// Bind the peer listener and spawn the mesh + consensus core. Separated from
/// `install()` so tests can run several nodes in one process.
pub async fn start(store: Arc<Store>, cfg: &ReplConfig) -> std::io::Result<Arc<ReplHandle>> {
    let listener = tokio::net::TcpListener::bind(&cfg.listen).await?;
    Ok(start_with_listener(store, cfg, listener))
}

pub fn start_with_listener(
    store: Arc<Store>,
    cfg: &ReplConfig,
    listener: tokio::net::TcpListener,
) -> Arc<ReplHandle> {
    let (incoming_tx, incoming_rx) = core::incoming_channel();
    let mesh = net::spawn(listener, &cfg.peers, cfg.id, incoming_tx);
    core::spawn_core(store, cfg, mesh, incoming_rx)
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
