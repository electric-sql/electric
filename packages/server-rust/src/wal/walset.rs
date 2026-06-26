//! The **sharded** WAL: `N` shards with a persisted `N`, fixed hash routing, and
//! the `--wal-shards` mismatch guard (design spec §5).
//!
//! # Why `N` is persisted, not recomputed per boot
//!
//! A stream must resolve to the **same shard** across restarts and across
//! machines with different core counts — otherwise its records would scatter
//! across shards and the per-shard lsn ordering that totally orders the stream
//! would be lost. So `N` is fixed at data-dir creation, written to
//! `<data-dir>/wal/shards`, and `shard_for` routes **only** from that persisted
//! `N` and the record's `stream_id`. `available_parallelism()` (the caller's
//! `default_n`) is consulted **only** when first persisting a fresh data dir.
//!
//! # Why a fixed hash (FNV-1a), not `DefaultHasher`
//!
//! `std::collections::hash_map::DefaultHasher` / `RandomState` are seeded per
//! process (SipHash with a random key), so `hash(stream_id) % N` would land a
//! stream on a *different* shard every boot — fatal for routing stability.
//! [`fnv1a`] is a fixed-constant FNV-1a over `stream_id.to_le_bytes()`: pure,
//! deterministic, identical across processes/builds/architectures.

use std::io;
use std::path::Path;
use std::sync::Arc;

use super::shard::Shard;

/// The persisted-`N` file under the data dir: `<data-dir>/wal/shards`.
const SHARDS_FILE: &str = "shards";

/// FNV-1a (64-bit) over `x.to_le_bytes()`. Fixed offset-basis/prime constants
/// make it a pure, process-stable function — unlike `DefaultHasher`, which is
/// seeded per process and would route a stream to a different shard every boot.
fn fnv1a(x: u64) -> u64 {
    const OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
    const PRIME: u64 = 0x0000_0100_0000_01b3;
    let mut h = OFFSET;
    for b in x.to_le_bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(PRIME);
    }
    h
}

/// `N` WAL shards with a persisted `N` and fixed `stream_id`→shard routing.
pub struct WalSet {
    shards: Vec<Arc<Shard>>,
    n: usize,
}

impl WalSet {
    /// Open the shard set rooted at `<data_dir>/wal`.
    ///
    /// The persisted `N` lives in `<data_dir>/wal/shards` (plain decimal text).
    /// - If that file **exists** and `requested_n == Some(x)` with `x != persisted`,
    ///   return `Err` — the caller (Task 8) maps this to exit 2. A `requested_n`
    ///   equal to the persisted `N`, or `None`, reuses the persisted `N`.
    /// - If it **does not exist**, persist `requested_n.unwrap_or(default_n)` and
    ///   create that many shards.
    ///
    /// `default_n` is the caller's `available_parallelism()` — used **only** on a
    /// fresh data dir, **never** to route once `N` is persisted.
    pub fn open(
        data_dir: &Path,
        requested_n: Option<usize>,
        default_n: usize,
    ) -> io::Result<Arc<WalSet>> {
        WalSet::open_with_segment_size(data_dir, requested_n, default_n, super::segment::SEGMENT_BYTES)
    }

    /// Like [`WalSet::open`] but with an explicit per-shard `segment_size` (the
    /// `fallocate` size + segment-roll threshold), threaded to every [`Shard`].
    /// Production passes [`super::segment::SEGMENT_BYTES`] via [`WalSet::open`];
    /// `--wal-segment-bytes` and tests pass a smaller size to force rolls.
    pub fn open_with_segment_size(
        data_dir: &Path,
        requested_n: Option<usize>,
        default_n: usize,
        segment_size: u64,
    ) -> io::Result<Arc<WalSet>> {
        let wal_dir = data_dir.join("wal");
        std::fs::create_dir_all(&wal_dir)?;
        let shards_path = wal_dir.join(SHARDS_FILE);

        let n = match read_persisted_n(&shards_path)? {
            Some(persisted) => {
                if let Some(req) = requested_n {
                    if req != persisted {
                        return Err(io::Error::new(
                            io::ErrorKind::InvalidInput,
                            format!(
                                "--wal-shards {req} does not match the persisted shard count {persisted} \
                                 for this data dir; the shard count is fixed at creation"
                            ),
                        ));
                    }
                }
                // `None`, or a matching request: reuse the persisted N (never default_n).
                persisted
            }
            None => {
                // Fresh data dir: persist the requested N, or the caller's default.
                let n = requested_n.unwrap_or(default_n).max(1);
                std::fs::write(&shards_path, n.to_string())?;
                n
            }
        };

        let mut shards = Vec::with_capacity(n);
        for i in 0..n {
            shards.push(Shard::open_with_segment_size(
                wal_dir.join(i.to_string()),
                segment_size,
            )?);
        }
        Ok(Arc::new(WalSet { shards, n }))
    }

    /// The shard a `stream_id` routes to — computed **only** from the persisted
    /// `N` and the `stream_id`, so it is identical across restarts and machines.
    /// Every record kind shares the stream's `stream_id`, so all of a stream's
    /// records land in this one shard.
    pub fn shard_for(&self, stream_id: u64) -> &Arc<Shard> {
        &self.shards[(fnv1a(stream_id) % self.n as u64) as usize]
    }

    /// The shards, for per-shard parallel recovery (spec §9). The sets of
    /// streams a shard owns are disjoint (`shard_for` routes deterministically),
    /// so replaying shards concurrently needs no cross-shard synchronization.
    pub fn shards(&self) -> &[Arc<Shard>] {
        &self.shards
    }

    /// Reset every shard's on-disk WAL to a fresh, empty state — called **once**,
    /// after `wal::recovery::recover` has replayed every durable record into the
    /// per-stream files and BEFORE `spawn_committers`/any append. See
    /// [`Shard::reset_after_recovery`] for why this is required for crash
    /// correctness (recover-before-clobber, design spec §9).
    pub fn reset_after_recovery(&self) -> io::Result<()> {
        for shard in &self.shards {
            shard.reset_after_recovery()?;
        }
        Ok(())
    }

    /// Spawn each shard's committer (the tokio-task `run_committer`).
    pub fn spawn_committers(self: &Arc<Self>) {
        for shard in &self.shards {
            let shard = Arc::clone(shard);
            tokio::spawn(shard.run_committer());
        }
    }
}

/// Read the persisted `N` from `path`, returning `None` if the file is absent.
fn read_persisted_n(path: &Path) -> io::Result<Option<usize>> {
    match std::fs::read_to_string(path) {
        Ok(s) => {
            let n = s.trim().parse::<usize>().map_err(|e| {
                io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!("corrupt {SHARDS_FILE} file ({path:?}): {e}"),
                )
            })?;
            if n == 0 {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!("corrupt {SHARDS_FILE} file ({path:?}): shard count is 0"),
                ));
            }
            Ok(Some(n))
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn tmp(tag: &str) -> PathBuf {
        use std::time::{SystemTime, UNIX_EPOCH};
        let p = std::env::temp_dir().join(format!(
            "ds-wal-walset-test-{tag}-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        let _ = std::fs::remove_dir_all(&p);
        p
    }

    #[tokio::test]
    async fn wal_shards_persisted_and_stable() {
        let d = tmp("wset");
        let w = WalSet::open(&d, Some(4), 16).unwrap(); // requested 4 → persisted 4 (default_n ignored)
        let s_id = 12345u64;
        let idx = w
            .shards
            .iter()
            .position(|s| std::ptr::eq(&**s, &**w.shard_for(s_id)))
            .unwrap();
        drop(w);
        // None + a DIFFERENT default_n (8) → still uses the persisted N (4), NOT default_n:
        let w2 = WalSet::open(&d, None, 8).unwrap();
        assert_eq!(w2.n, 4);
        let idx2 = w2
            .shards
            .iter()
            .position(|s| std::ptr::eq(&**s, &**w2.shard_for(s_id)))
            .unwrap();
        assert_eq!(idx, idx2, "stream resolves to the same shard across reopen");
        assert!(
            WalSet::open(&d, Some(8), 8).is_err(),
            "mismatched --wal-shards rejected"
        );
    }
}
