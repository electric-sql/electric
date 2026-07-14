//! Write-ahead log (`--durability wal`) — sharded, segmented, append-only.
//!
//! This module is **inert** unless `--durability wal` is selected; with the WAL
//! off the server is byte-for-byte the `strict`/`fast` server. See the
//! durable-wal-v2 design spec for the architecture.
//!
//! The codec's public API is the foundation the WAL tasks (segments, committers,
//! sharding, recovery) consume; the WAL is now wired into the append path
//! (`maybe_sync_on_ack`'s `Wal` arm), so no module-wide `dead_code` allow.

pub mod codec;
pub mod recovery;
pub mod segment;
pub mod shard;
pub mod telemetry;
pub mod walset;

#[cfg(test)]
mod e2e_tests;
#[cfg(test)]
mod fault_tests;

#[cfg(test)]
mod sim_tests;
