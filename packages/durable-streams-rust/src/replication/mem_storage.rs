//! In-memory OmniPaxos storage. Deliberate: durability comes from quorum
//! replication, not disk (REPLICATION.md "Storage"). Adapted from
//! `omnipaxos_storage::memory_storage::MemoryStorage` (Apache-2.0) — vendored
//! to avoid pulling that crate's unconditional commitlog/sled dependencies.

use omnipaxos::ballot_leader_election::Ballot;
use omnipaxos::storage::{Entry, StopSign, Storage, StorageResult};

pub struct MemStorage<T>
where
    T: Entry,
{
    /// The in-memory log (suffix above `trimmed_idx`).
    log: Vec<T>,
    /// Last promised round.
    n_prom: Ballot,
    /// Last accepted round.
    acc_round: Ballot,
    /// Length of the decided prefix.
    ld: u64,
    /// Garbage-collected (trimmed) index.
    trimmed_idx: u64,
    snapshot: Option<T::Snapshot>,
    stopsign: Option<StopSign>,
}

impl<T: Entry> Default for MemStorage<T> {
    fn default() -> Self {
        Self {
            log: vec![],
            n_prom: Ballot::default(),
            acc_round: Ballot::default(),
            ld: 0,
            trimmed_idx: 0,
            snapshot: None,
            stopsign: None,
        }
    }
}

impl<T> Storage<T> for MemStorage<T>
where
    T: Entry,
{
    fn append_entry(&mut self, entry: T) -> StorageResult<u64> {
        self.log.push(entry);
        self.get_log_len()
    }

    fn append_entries(&mut self, entries: Vec<T>) -> StorageResult<u64> {
        let mut e = entries;
        self.log.append(&mut e);
        self.get_log_len()
    }

    fn append_on_prefix(&mut self, from_idx: u64, entries: Vec<T>) -> StorageResult<u64> {
        self.log.truncate(from_idx as usize);
        self.append_entries(entries)
    }

    fn set_promise(&mut self, n_prom: Ballot) -> StorageResult<()> {
        self.n_prom = n_prom;
        Ok(())
    }

    fn set_decided_idx(&mut self, ld: u64) -> StorageResult<()> {
        self.ld = ld;
        Ok(())
    }

    fn get_decided_idx(&self) -> StorageResult<u64> {
        Ok(self.ld)
    }

    fn set_accepted_round(&mut self, na: Ballot) -> StorageResult<()> {
        self.acc_round = na;
        Ok(())
    }

    fn get_accepted_round(&self) -> StorageResult<Option<Ballot>> {
        Ok(Some(self.acc_round))
    }

    fn get_entries(&self, from: u64, to: u64) -> StorageResult<Vec<T>> {
        Ok(self
            .log
            .get(from as usize..to as usize)
            .unwrap_or(&[])
            .to_vec())
    }

    fn get_log_len(&self) -> StorageResult<u64> {
        Ok(self.log.len() as u64)
    }

    fn get_suffix(&self, from: u64) -> StorageResult<Vec<T>> {
        Ok(match self.log.get(from as usize..) {
            Some(s) => s.to_vec(),
            None => vec![],
        })
    }

    fn get_promise(&self) -> StorageResult<Option<Ballot>> {
        Ok(Some(self.n_prom))
    }

    fn set_stopsign(&mut self, s: Option<StopSign>) -> StorageResult<()> {
        self.stopsign = s;
        Ok(())
    }

    fn get_stopsign(&self) -> StorageResult<Option<StopSign>> {
        Ok(self.stopsign.clone())
    }

    fn trim(&mut self, trimmed_idx: u64) -> StorageResult<()> {
        self.log
            .drain(0..(trimmed_idx as usize).min(self.log.len()));
        Ok(())
    }

    fn set_compacted_idx(&mut self, trimmed_idx: u64) -> StorageResult<()> {
        self.trimmed_idx = trimmed_idx;
        Ok(())
    }

    fn get_compacted_idx(&self) -> StorageResult<u64> {
        Ok(self.trimmed_idx)
    }

    fn set_snapshot(&mut self, snapshot: Option<T::Snapshot>) -> StorageResult<()> {
        self.snapshot = snapshot;
        Ok(())
    }

    fn get_snapshot(&self) -> StorageResult<Option<T::Snapshot>> {
        Ok(self.snapshot.clone())
    }
}
