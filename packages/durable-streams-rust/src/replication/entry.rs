//! The replicated-log operation types (what goes through consensus) and the
//! apply outcomes (what comes back). See REPLICATION.md.
//!
//! With openraft, `LogOp` is the Raft `D` (app data) type and `OpOutcome` the
//! `R` (response) type: `Raft::client_write(LogOp)` resolves with the outcome
//! the state machine computed when it applied the decided entry — the ack IS
//! the apply result. Outcomes are serde because they also travel back over
//! the forward-to-leader RPC.

use serde::{Deserialize, Serialize};

use crate::store::StreamConfig;

/// Producer identity for idempotent appends, replicated so dedup/fencing is
/// evaluated deterministically at apply time on every node.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ReplProducer {
    pub id: String,
    pub epoch: u64,
    pub seq: u64,
}

/// A state-mutating operation. Everything that changes stream state goes
/// through the log; reads never do. Wire bytes are already encoded
/// (`encode_wire` ran on the proposing node), so apply is a byte append.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum LogOp {
    /// `PUT /s` — create (including fork; the fork point is pre-resolved into
    /// `base_offset` by the proposing node so apply does no read I/O).
    Create {
        path: String,
        config: StreamConfig,
        base_offset: u64,
        /// Optional initial body (already wire-encoded).
        wire: Vec<u8>,
    },
    /// `POST /s` — append and/or close.
    Append {
        path: String,
        wire: Vec<u8>,
        producer: Option<ReplProducer>,
        seq: Option<String>,
        close: bool,
    },
    /// `DELETE /s`.
    Delete { path: String },
}

impl LogOp {
    pub fn path(&self) -> &str {
        match self {
            LogOp::Create { path, .. } | LogOp::Append { path, .. } | LogOp::Delete { path } => {
                path
            }
        }
    }
}

// ---------- apply outcomes ----------

/// Outcome of applying a decided `LogOp`, returned to the proposing client.
/// Mirrors the single-node handlers' response cases.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum OpOutcome {
    Append(AppendApplyOutcome),
    Create(CreateApplyOutcome),
    Delete(DeleteApplyOutcome),
    /// Raft-internal entries (blank on leader change, membership) — never
    /// surfaced to an HTTP client.
    Noop,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum AppendApplyOutcome {
    /// Bytes written (and/or closed) — the success ack.
    Applied { tail: u64, closed: bool },
    /// Stream vanished between propose and apply.
    NotFound,
    Gone,
    /// Producer retried the exact close that closed the stream → idempotent 204.
    ClosedDupClose { tail: u64, epoch: u64, seq: u64 },
    /// Bare close of an already-closed stream → idempotent 204.
    ClosedIdempotent { tail: u64 },
    /// Append to a closed stream → 409.
    Closed { tail: u64 },
    ProducerDuplicate { tail: u64, closed: bool, epoch: u64, last_seq: u64 },
    ProducerStaleEpoch { tail: u64, current: u64 },
    ProducerGap { expected: u64, received: u64 },
    ProducerBadEpochStart,
    SeqConflict { tail: u64 },
    WriteFailed,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum CreateApplyOutcome {
    Created { tail: u64, closed: bool },
    Exists { tail: u64, closed: bool, content_type: String },
    Conflict,
    /// Fork parent vanished between propose and apply.
    ForkSourceMissing,
    WriteFailed,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum DeleteApplyOutcome {
    Deleted,
    NotFound,
    Gone,
}
