//! Write-ahead log (`--durability wal`) — sharded, segmented, append-only.
//!
//! This module is **inert** unless `--durability wal` is selected; with the WAL
//! off the server is byte-for-byte the `strict`/`fast` server. See the
//! durable-wal-v2 design spec for the architecture.
//!
//! The codec's public API is the foundation that later WAL tasks (segments,
//! committers, sharding, recovery) consume; until those land it has no in-crate
//! caller, so `dead_code` is allowed module-wide rather than peppering each item
//! with `#[allow]`. The allow is removed once the WAL is wired into the append
//! path.
#![allow(dead_code)]

pub mod codec;
pub mod recovery;
pub mod segment;
pub mod shard;
pub mod telemetry;
pub mod walset;

#[cfg(test)]
mod e2e_tests;
