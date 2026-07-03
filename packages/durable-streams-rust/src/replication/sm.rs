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

use super::entry::{AppendApplyOutcome, CreateApplyOutcome, LogOp, OpOutcome};
use super::types::{Entry, NodeId, TypeConfig};
use crate::store::{Store, StreamState};

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
}

impl StateMachine {
    pub fn new(store: Arc<Store>) -> Arc<Self> {
        Arc::new(StateMachine {
            store,
            meta: RwLock::new(SmMeta::default()),
            dirty: Mutex::new(HashMap::new()),
            apply_max_us: std::sync::atomic::AtomicU64::new(0),
            applied_ops: std::sync::atomic::AtomicU64::new(0),
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
        // Metadata-only marker (see module docs): exists so the log purges.
        let meta = self.meta.read().await;
        let snapshot_id = meta
            .last_applied
            .map(|l| format!("marker-{}-{}", l.leader_id, l.index))
            .unwrap_or_else(|| "marker-empty".to_string());
        Ok(Snapshot {
            meta: SnapshotMeta {
                last_log_id: meta.last_applied,
                last_membership: meta.last_membership.clone(),
                snapshot_id,
            },
            snapshot: Box::new(Cursor::new(Vec::new())),
        })
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
        let mut pos = 0usize;
        let mut last_applied = None;
        let mut last_membership = None;
        for entry in entries {
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
            pos += 1;
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
        // v1: no state transfer — a follower behind the purge horizon cannot
        // be rebuilt from a marker snapshot. Refuse loudly (fail-stop).
        Err(StorageIOError::read_snapshot(
            None,
            &std::io::Error::new(
                std::io::ErrorKind::Unsupported,
                "snapshot install unsupported in v1 (marker snapshots only) — \
                 replace the node / restart the cluster (REPLICATION.md)",
            ),
        )
        .into())
    }

    async fn install_snapshot(
        &mut self,
        meta: &SnapshotMeta<NodeId, BasicNode>,
        _snapshot: Box<Cursor<Vec<u8>>>,
    ) -> Result<(), StorageError<NodeId>> {
        Err(StorageIOError::read_snapshot(
            Some(meta.signature()),
            &std::io::Error::new(
                std::io::ErrorKind::Unsupported,
                "snapshot install unsupported in v1 (marker snapshots only)",
            ),
        )
        .into())
    }

    async fn get_current_snapshot(
        &mut self,
    ) -> Result<Option<Snapshot<TypeConfig>>, StorageError<NodeId>> {
        // Never offer a snapshot for replication — marker snapshots carry no
        // state. Lagging followers must be caught up from the log or not at all.
        Ok(None)
    }

    async fn get_snapshot_builder(&mut self) -> Self::SnapshotBuilder {
        self.clone()
    }
}
