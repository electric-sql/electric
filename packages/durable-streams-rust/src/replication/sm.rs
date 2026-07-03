//! The Raft state machine: folds decided `LogOp`s into the local `Store`
//! through the same apply twins the single-node handlers mirror
//! (`handlers::apply_replicated_*`) — log-first apply, REPLICATION.md.
//!
//! Batch applies are SHARDED by stream path (per-stream log order preserved):
//! one slow store write (an fs-journal stall) must not serialize every other
//! stream's ack — the lesson measured under omnipaxos (100–450 ms apply
//! stalls) carries over unchanged. Fork-creates read the parent stream, which
//! may hash to another shard, so they act as a barrier and apply inline.
//!
//! Snapshots are METADATA-ONLY MARKERS: the stream files are the real state,
//! and v1 has no state transfer. Building one is cheap (it exists so openraft
//! purges the log — that is how memory stays bounded); INSTALLING one is
//! refused loudly, so a follower that fell behind the purge horizon stays
//! behind (fail-stop, REPLICATION.md "Guarantees") instead of silently
//! diverging.

use std::collections::HashMap;
use std::io::Cursor;
use std::sync::Arc;

use openraft::storage::{RaftStateMachine, Snapshot};
use openraft::{
    BasicNode, EntryPayload, LogId, RaftSnapshotBuilder, SnapshotMeta, StorageError,
    StorageIOError, StoredMembership,
};
use tokio::sync::{Mutex, RwLock};

use serde::{Deserialize, Serialize};

use super::entry::{AppendApplyOutcome, CreateApplyOutcome, LogOp, OpOutcome};
use super::types::{Entry, NodeId, TypeConfig};
use crate::store::{Store, StreamConfig, StreamState};

/// One stream in a snapshot MANIFEST. Snapshots carry metadata only — the
/// byte content is pulled over the mesh at install time (`FetchStream` RPC),
/// which the append-only model makes safe: a stream's `[0, tail)` prefix is
/// immutable, so fetching it later from a peer that has advanced still yields
/// exactly the bytes at snapshot time. `id` guards against the path being
/// deleted+recreated in between (the serving peer verifies it).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamSnap {
    pub path: String,
    pub id: u64,
    pub config: StreamConfig,
    pub tail: u64,
    pub closed: bool,
    pub closed_by: Option<(String, u64, u64)>,
    pub producers: Vec<(String, u64, u64)>,
    pub last_seq_header: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Manifest {
    pub streams: Vec<StreamSnap>,
}

/// Wiring the state machine needs for snapshot INSTALL (fetching bytes from
/// the current leader) — populated after `Raft::new` by `mod.rs`.
pub struct InstallCtx {
    pub self_id: NodeId,
    pub clients: Arc<super::net::Clients>,
    pub metrics: tokio::sync::watch::Receiver<openraft::RaftMetrics<NodeId, BasicNode>>,
}

const APPLY_SHARDS: usize = 4;
/// Dirty meta sidecars are swept on this cadence (vs per-append rewrites,
/// whose rename churn caused the fs stalls in the first place).
pub(super) const META_SWEEP: std::time::Duration = std::time::Duration::from_secs(3);

#[derive(Debug, Clone, Default)]
pub struct SmMeta {
    pub last_applied: Option<LogId<NodeId>>,
    pub last_membership: StoredMembership<NodeId, BasicNode>,
}

pub struct StateMachine {
    pub store: Arc<Store>,
    pub meta: RwLock<SmMeta>,
    /// Streams touched since the last sweep — flushed by the sweeper task.
    pub dirty: Mutex<HashMap<u64, Arc<StreamState>>>,
    /// Worst single-op apply time since last stats emit, µs.
    pub apply_max_us: std::sync::atomic::AtomicU64,
    /// Ops applied (cumulative).
    pub applied_ops: std::sync::atomic::AtomicU64,
    /// The last built manifest snapshot (offered to lagging followers).
    pub current_snapshot: RwLock<Option<(SnapshotMeta<NodeId, BasicNode>, Manifest)>>,
    /// Fetch wiring for snapshot install — set once by `mod.rs` after boot.
    pub install_ctx: std::sync::OnceLock<InstallCtx>,
}

impl StateMachine {
    pub fn new(store: Arc<Store>) -> Arc<Self> {
        Arc::new(StateMachine {
            store,
            meta: RwLock::new(SmMeta::default()),
            dirty: Mutex::new(HashMap::new()),
            apply_max_us: std::sync::atomic::AtomicU64::new(0),
            applied_ops: std::sync::atomic::AtomicU64::new(0),
            current_snapshot: RwLock::new(None),
            install_ctx: std::sync::OnceLock::new(),
        })
    }

    /// Spawn the periodic dirty-meta sweeper. Flushes are detached onto the
    /// blocking pool — a slow sweep must not stall applies.
    pub fn spawn_meta_sweeper(self: &Arc<Self>) {
        let sm = Arc::clone(self);
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(META_SWEEP);
            tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                tick.tick().await;
                let drained: Vec<Arc<StreamState>> =
                    sm.dirty.lock().await.drain().map(|(_, st)| st).collect();
                for st in drained {
                    tokio::task::spawn_blocking(move || {
                        let _ = crate::store::write_meta_sync(&st, false);
                    });
                }
            }
        });
    }

    fn shard_for(path: &str) -> usize {
        use std::hash::{Hash, Hasher};
        let mut h = std::collections::hash_map::DefaultHasher::new();
        path.hash(&mut h);
        (h.finish() as usize) % APPLY_SHARDS
    }

    async fn apply_op(store: &Arc<Store>, op: LogOp) -> (OpOutcome, bool) {
        match op {
            LogOp::Create {
                path,
                config,
                base_offset,
                wire,
            } => {
                let out = crate::handlers::apply_replicated_create(
                    store,
                    &path,
                    config,
                    base_offset,
                    wire,
                )
                .await;
                let dirty = matches!(out, CreateApplyOutcome::Created { .. });
                (OpOutcome::Create(out), dirty)
            }
            LogOp::Append {
                path,
                wire,
                producer,
                seq,
                close,
            } => {
                let out = crate::handlers::apply_replicated_append(
                    store, &path, wire, producer, seq, close,
                )
                .await;
                let dirty = matches!(out, AppendApplyOutcome::Applied { .. });
                (OpOutcome::Append(out), dirty)
            }
            LogOp::Delete { path } => (
                OpOutcome::Delete(crate::handlers::apply_replicated_delete(store, &path).await),
                false,
            ),
        }
    }

    /// Apply a run of (batch position, op) pairs — sequential within the run
    /// (same shard ⇒ per-stream order), one run per shard concurrently.
    async fn apply_run(
        store: Arc<Store>,
        run: Vec<(usize, LogOp, String)>,
        sm: Arc<StateMachine>,
    ) -> Vec<(usize, OpOutcome)> {
        let mut out = Vec::with_capacity(run.len());
        for (pos, op, path) in run {
            let t0 = std::time::Instant::now();
            let (outcome, dirty) = Self::apply_op(&store, op).await;
            let us = t0.elapsed().as_micros() as u64;
            sm.apply_max_us
                .fetch_max(us, std::sync::atomic::Ordering::Relaxed);
            sm.applied_ops
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            if dirty {
                if let Some(st) = store.get(&path) {
                    sm.dirty.lock().await.entry(st.id).or_insert(st);
                }
            }
            out.push((pos, outcome));
        }
        out
    }

    /// Apply a group of ops sharded by path; returns outcomes indexed by
    /// batch position.
    async fn apply_group(self: &Arc<Self>, group: Vec<(usize, LogOp)>, out: &mut Vec<(usize, OpOutcome)>) {
        let mut runs: Vec<Vec<(usize, LogOp, String)>> = (0..APPLY_SHARDS).map(|_| Vec::new()).collect();
        for (pos, op) in group {
            let path = op.path().to_string();
            runs[Self::shard_for(&path)].push((pos, op, path));
        }
        let mut joins = Vec::new();
        for run in runs {
            if run.is_empty() {
                continue;
            }
            let store = Arc::clone(&self.store);
            let sm = Arc::clone(self);
            joins.push(tokio::spawn(Self::apply_run(store, run, sm)));
        }
        for j in joins {
            if let Ok(res) = j.await {
                out.extend(res);
            }
        }
    }
}

impl RaftSnapshotBuilder<TypeConfig> for Arc<StateMachine> {
    async fn build_snapshot(&mut self) -> Result<Snapshot<TypeConfig>, StorageError<NodeId>> {
        // MANIFEST snapshot: O(streams) metadata, no byte content (module
        // docs). Built under the meta read lock so `last_applied` and the
        // captured stream tails are mutually consistent (applies advance
        // last_applied only after mutating the store, and tails captured here
        // are ≥ the snapshot index's — over-capture is safe: prefixes are
        // immutable and log replay past the snapshot re-applies
        // deterministically via producer dedup / publish monotonicity).
        let meta = self.meta.read().await;
        let mut streams = Vec::new();
        for entry in self.store.streams.iter() {
            let st = entry.value();
            let s = st.shared.read().unwrap();
            if s.soft_deleted {
                continue;
            }
            streams.push(StreamSnap {
                path: st.path.clone(),
                id: st.id,
                config: st.config.clone(),
                tail: s.durable_tail,
                closed: s.closed_durable,
                closed_by: s.closed_by.clone(),
                producers: s
                    .producers
                    .iter()
                    .map(|(k, v)| (k.clone(), v.epoch, v.last_seq))
                    .collect(),
                last_seq_header: s.last_seq_header.clone(),
            });
        }
        let manifest = Manifest { streams };
        let snapshot_id = meta
            .last_applied
            .map(|l| format!("manifest-{}-{}", l.leader_id, l.index))
            .unwrap_or_else(|| "manifest-empty".to_string());
        let snap_meta = SnapshotMeta {
            last_log_id: meta.last_applied,
            last_membership: meta.last_membership.clone(),
            snapshot_id,
        };
        let data = bincode::serialize(&manifest)
            .map_err(|e| StorageIOError::write_snapshot(Some(snap_meta.signature()), &e))?;
        drop(meta);
        *self.current_snapshot.write().await = Some((snap_meta.clone(), manifest));
        Ok(Snapshot {
            meta: snap_meta,
            snapshot: Box::new(Cursor::new(data)),
        })
    }
}

impl StateMachine {
    /// Rebuild the whole store from a manifest: wipe, recreate every stream,
    /// pull its immutable byte prefix from the current leader over the mesh,
    /// and restore producer/closed state. Fork children are materialized flat
    /// (their logical content, standalone) — reads are byte-identical.
    async fn install_manifest(
        &self,
        meta: &SnapshotMeta<NodeId, BasicNode>,
        manifest: Manifest,
    ) -> Result<(), StorageError<NodeId>> {
        fn io_err_from(
            sig: openraft::storage::SnapshotSignature<NodeId>,
            e: impl std::error::Error + 'static,
        ) -> StorageError<NodeId> {
            StorageError::from(StorageIOError::read_snapshot(Some(sig), &e))
        }
        let io_err = |e: std::io::Error| io_err_from(meta.signature(), e);
        let ctx = self.install_ctx.get().ok_or_else(|| {
            io_err(std::io::Error::other("snapshot install ctx not wired"))
        })?;
        // Pull from the current leader (who else could have sent a snapshot);
        // any peer at/above the snapshot index would do. The leader's mesh
        // address comes from the snapshot's membership.
        let m = ctx.metrics.borrow().clone();
        let leader = m
            .current_leader
            .filter(|l| *l != ctx.self_id)
            .ok_or_else(|| io_err(std::io::Error::other("no leader to fetch from")))?;
        let leader_addr = meta
            .last_membership
            .membership()
            .nodes()
            .find(|(id, _)| **id == leader)
            .map(|(_, n)| n.addr.clone())
            .or_else(|| {
                m.membership_config
                    .membership()
                    .nodes()
                    .find(|(id, _)| **id == leader)
                    .map(|(_, n)| n.addr.clone())
            })
            .ok_or_else(|| io_err(std::io::Error::other("leader not in membership")))?;
        let client = ctx.clients.get_or_create(leader, &leader_addr);

        self.store.wipe_all().map_err(|e| io_err(std::io::Error::other(e.to_string())))?;
        for snap in manifest.streams {
            let store = Arc::clone(&self.store);
            let path = snap.path.clone();
            let config = snap.config.clone();
            let created = tokio::task::spawn_blocking(move || {
                store.create_with_meta_durability(&path, config, None, 0, false)
            })
            .await
            .map_err(|e| io_err(std::io::Error::other(e.to_string())))?
            .map_err(|e| io_err(std::io::Error::other(e.to_string())))?;
            let crate::store::CreateResult::Created(st) = created else {
                return Err(io_err(std::io::Error::other(format!(
                    "stream {} already exists during install",
                    snap.path
                ))));
            };
            // Fetch [0, tail) in chunks from the leader and append.
            const CHUNK: u64 = 4 * 1024 * 1024;
            let mut off = 0u64;
            while off < snap.tail {
                let to = (off + CHUNK).min(snap.tail);
                let bytes = client
                    .fetch_stream(&snap.path, snap.id, off, to)
                    .await
                    .map_err(|e| io_err(std::io::Error::other(e)))?;
                if bytes.len() as u64 != to - off {
                    return Err(io_err(std::io::Error::other(format!(
                        "short fetch for {} [{off},{to})",
                        snap.path
                    ))));
                }
                let wire = bytes::Bytes::from(bytes);
                let mut ap = st.appender.lock().await;
                let new_tail =
                    crate::handlers::write_wire(&st, &mut ap, &wire).map_err(|e| io_err(std::io::Error::other(e.to_string())))?;
                drop(ap);
                crate::handlers::publish_durable_tail(&st, new_tail, &wire);
                off = to;
            }
            // Restore replicated per-stream state.
            {
                let mut sh = st.shared.write().unwrap();
                for (id, epoch, last_seq) in snap.producers {
                    sh.producers
                        .insert(id, crate::store::ProducerState { epoch, last_seq });
                }
                sh.last_seq_header = snap.last_seq_header;
                if snap.closed {
                    sh.closed = true;
                    sh.closed_durable = true;
                    sh.closed_by = snap.closed_by;
                }
            }
            if snap.closed {
                let t = st.tail().bytes;
                st.tail_tx.send_replace(crate::store::Tail {
                    bytes: t,
                    closed: true,
                });
            }
            self.dirty.lock().await.insert(st.id, Arc::clone(&st));
        }
        Ok(())
    }
}

impl RaftStateMachine<TypeConfig> for Arc<StateMachine> {
    type SnapshotBuilder = Self;

    async fn applied_state(
        &mut self,
    ) -> Result<(Option<LogId<NodeId>>, StoredMembership<NodeId, BasicNode>), StorageError<NodeId>>
    {
        let meta = self.meta.read().await;
        Ok((meta.last_applied, meta.last_membership.clone()))
    }

    async fn apply<I>(&mut self, entries: I) -> Result<Vec<OpOutcome>, StorageError<NodeId>>
    where
        I: IntoIterator<Item = Entry> + Send,
    {
        // Partition the batch into parallel groups; a fork-create is a
        // barrier (it reads its parent stream, possibly on another shard).
        let mut responses: Vec<(usize, OpOutcome)> = Vec::new();
        let mut group: Vec<(usize, LogOp)> = Vec::new();
        let mut last_applied = None;
        let mut last_membership = None;
        for (pos, entry) in entries.into_iter().enumerate() {
            last_applied = Some(entry.log_id);
            match entry.payload {
                EntryPayload::Blank => responses.push((pos, OpOutcome::Noop)),
                EntryPayload::Membership(ref mem) => {
                    last_membership = Some(StoredMembership::new(Some(entry.log_id), mem.clone()));
                    responses.push((pos, OpOutcome::Noop));
                }
                EntryPayload::Normal(op) => {
                    let is_fork = matches!(
                        &op,
                        LogOp::Create { config, .. } if config.forked_from.is_some()
                    );
                    if is_fork {
                        self.apply_group(std::mem::take(&mut group), &mut responses).await;
                        let (outcome, _) = StateMachine::apply_op(&self.store, op).await;
                        responses.push((pos, outcome));
                    } else {
                        group.push((pos, op));
                    }
                }
            }
        }
        self.apply_group(group, &mut responses).await;

        {
            let mut meta = self.meta.write().await;
            meta.last_applied = last_applied.or(meta.last_applied);
            if let Some(m) = last_membership {
                meta.last_membership = m;
            }
        }
        responses.sort_by_key(|(p, _)| *p);
        Ok(responses.into_iter().map(|(_, o)| o).collect())
    }

    async fn begin_receiving_snapshot(
        &mut self,
    ) -> Result<Box<Cursor<Vec<u8>>>, StorageError<NodeId>> {
        Ok(Box::new(Cursor::new(Vec::new())))
    }

    async fn install_snapshot(
        &mut self,
        meta: &SnapshotMeta<NodeId, BasicNode>,
        snapshot: Box<Cursor<Vec<u8>>>,
    ) -> Result<(), StorageError<NodeId>> {
        let manifest: Manifest = bincode::deserialize(snapshot.get_ref())
            .map_err(|e| StorageIOError::read_snapshot(Some(meta.signature()), &e))?;
        self.install_manifest(meta, manifest.clone()).await?;
        {
            let mut m = self.meta.write().await;
            m.last_applied = meta.last_log_id;
            m.last_membership = meta.last_membership.clone();
        }
        *self.current_snapshot.write().await = Some((meta.clone(), manifest));
        Ok(())
    }

    async fn get_current_snapshot(
        &mut self,
    ) -> Result<Option<Snapshot<TypeConfig>>, StorageError<NodeId>> {
        let cur = self.current_snapshot.read().await;
        match &*cur {
            None => Ok(None),
            Some((meta, manifest)) => {
                let data = bincode::serialize(manifest)
                    .map_err(|e| StorageIOError::read_snapshot(Some(meta.signature()), &e))?;
                Ok(Some(Snapshot {
                    meta: meta.clone(),
                    snapshot: Box::new(Cursor::new(data)),
                }))
            }
        }
    }

    async fn get_snapshot_builder(&mut self) -> Self::SnapshotBuilder {
        self.clone()
    }
}
