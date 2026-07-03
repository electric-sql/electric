//! In-memory openraft log store (log entries + vote). Deliberate: durability
//! comes from quorum replication, not disk (REPLICATION.md "Storage").
//! Vendored from openraft's `examples/memstore` (MIT/Apache-2.0) — the
//! reference in-memory `RaftLogStorage` — to avoid an examples-only dep.
//!
//! The VOTE, however, is durable when a `vote_path` is configured (it is in
//! production boots): it changes only at election time — never on the append
//! hot path — and persisting it is what makes restart-rejoin safe (a node
//! that forgot its vote could grant conflicting elections).

use std::collections::BTreeMap;
use std::fmt::Debug;
use std::ops::RangeBounds;
use std::sync::Arc;

use openraft::storage::{LogFlushed, RaftLogStorage};
use openraft::{LogId, LogState, RaftLogId, RaftLogReader, RaftTypeConfig, StorageError, Vote};
use tokio::sync::Mutex;

#[derive(Clone, Debug, Default)]
pub struct LogStore<C: RaftTypeConfig> {
    inner: Arc<Mutex<LogStoreInner<C>>>,
    /// When set, the vote is fsynced here on every change and reloaded at boot.
    vote_path: Option<std::path::PathBuf>,
}

#[derive(Debug)]
pub struct LogStoreInner<C: RaftTypeConfig> {
    last_purged_log_id: Option<LogId<C::NodeId>>,
    log: BTreeMap<u64, C::Entry>,
    committed: Option<LogId<C::NodeId>>,
    vote: Option<Vote<C::NodeId>>,
}

impl<C: RaftTypeConfig> Default for LogStoreInner<C> {
    fn default() -> Self {
        Self {
            last_purged_log_id: None,
            log: BTreeMap::new(),
            committed: None,
            vote: None,
        }
    }
}

impl<C: RaftTypeConfig> LogStore<C>
where
    Vote<C::NodeId>: serde::Serialize + serde::de::DeserializeOwned,
{
    /// A log store with a durable vote file (loaded now if present).
    pub fn with_vote_path(path: std::path::PathBuf) -> std::io::Result<Self> {
        let mut inner = LogStoreInner::<C>::default();
        match std::fs::read(&path) {
            Ok(bytes) => {
                inner.vote = Some(bincode::deserialize(&bytes).map_err(|e| {
                    std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        format!("corrupt vote file {}: {e}", path.display()),
                    )
                })?);
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e),
        }
        Ok(LogStore {
            inner: Arc::new(Mutex::new(inner)),
            vote_path: Some(path),
        })
    }
}

impl<C: RaftTypeConfig> LogStore<C> {
    /// (window_entries, last_purged_index) for REPL_STATS.
    pub async fn window(&self) -> (usize, u64) {
        let inner = self.inner.lock().await;
        (
            inner.log.len(),
            inner.last_purged_log_id.as_ref().map(|l| l.index).unwrap_or(0),
        )
    }
}

impl<C: RaftTypeConfig> RaftLogReader<C> for LogStore<C>
where
    C::Entry: Clone,
{
    async fn try_get_log_entries<RB: RangeBounds<u64> + Clone + Debug>(
        &mut self,
        range: RB,
    ) -> Result<Vec<C::Entry>, StorageError<C::NodeId>> {
        let inner = self.inner.lock().await;
        Ok(inner.log.range(range).map(|(_, val)| val.clone()).collect())
    }
}

impl<C: RaftTypeConfig> RaftLogStorage<C> for LogStore<C>
where
    C::Entry: Clone,
{
    type LogReader = Self;

    async fn get_log_state(&mut self) -> Result<LogState<C>, StorageError<C::NodeId>> {
        let inner = self.inner.lock().await;
        let last = inner.log.iter().next_back().map(|(_, ent)| ent.get_log_id().clone());
        let last_purged = inner.last_purged_log_id.clone();
        Ok(LogState {
            last_purged_log_id: last_purged.clone(),
            last_log_id: last.or(last_purged),
        })
    }

    async fn save_committed(
        &mut self,
        committed: Option<LogId<C::NodeId>>,
    ) -> Result<(), StorageError<C::NodeId>> {
        self.inner.lock().await.committed = committed;
        Ok(())
    }

    async fn read_committed(
        &mut self,
    ) -> Result<Option<LogId<C::NodeId>>, StorageError<C::NodeId>> {
        Ok(self.inner.lock().await.committed.clone())
    }

    async fn save_vote(&mut self, vote: &Vote<C::NodeId>) -> Result<(), StorageError<C::NodeId>> {
        // Durable BEFORE visible: a vote acknowledged and then forgotten can
        // grant two conflicting elections. Election-time only — never on the
        // append hot path.
        if let Some(path) = &self.vote_path {
            let write = || -> std::io::Result<()> {
                let bytes = bincode::serialize(vote)
                    .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
                let tmp = path.with_extension("tmp");
                {
                    use std::io::Write;
                    let mut f = std::fs::File::create(&tmp)?;
                    f.write_all(&bytes)?;
                    f.sync_all()?;
                }
                std::fs::rename(&tmp, path)?;
                Ok(())
            };
            let path2 = path.clone();
            write().map_err(|e| {
                StorageError::from(openraft::StorageIOError::write_vote(
                    &std::io::Error::new(
                        e.kind(),
                        format!("vote file {}: {e}", path2.display()),
                    ),
                ))
            })?;
        }
        self.inner.lock().await.vote = Some(vote.clone());
        Ok(())
    }

    async fn read_vote(&mut self) -> Result<Option<Vote<C::NodeId>>, StorageError<C::NodeId>> {
        Ok(self.inner.lock().await.vote.clone())
    }

    async fn append<I>(
        &mut self,
        entries: I,
        callback: LogFlushed<C>,
    ) -> Result<(), StorageError<C::NodeId>>
    where
        I: IntoIterator<Item = C::Entry>,
    {
        let mut inner = self.inner.lock().await;
        for entry in entries {
            inner.log.insert(entry.get_log_id().index, entry);
        }
        // In-memory: the "flush" is the insert itself.
        callback.log_io_completed(Ok(()));
        Ok(())
    }

    async fn truncate(&mut self, log_id: LogId<C::NodeId>) -> Result<(), StorageError<C::NodeId>> {
        let mut inner = self.inner.lock().await;
        let keys: Vec<u64> = inner.log.range(log_id.index..).map(|(k, _)| *k).collect();
        for key in keys {
            inner.log.remove(&key);
        }
        Ok(())
    }

    async fn purge(&mut self, log_id: LogId<C::NodeId>) -> Result<(), StorageError<C::NodeId>> {
        let mut inner = self.inner.lock().await;
        assert!(inner.last_purged_log_id.as_ref() <= Some(&log_id));
        let purge_idx = log_id.index;
        inner.last_purged_log_id = Some(log_id);
        let keys: Vec<u64> = inner.log.range(..=purge_idx).map(|(k, _)| *k).collect();
        for key in keys {
            inner.log.remove(&key);
        }
        Ok(())
    }

    async fn get_log_reader(&mut self) -> Self::LogReader {
        self.clone()
    }
}
