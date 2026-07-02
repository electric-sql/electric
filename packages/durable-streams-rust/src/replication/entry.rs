//! The replicated-log entry types (what goes through consensus) and the apply
//! outcomes (what comes back). See REPLICATION.md.

use omnipaxos::storage::{Entry, NoSnapshot};
use serde::{Deserialize, Serialize};

use crate::store::StreamConfig;

/// One entry in the OmniPaxos log. `origin`/`req_id` tag the proposing node's
/// pending HTTP request so the applier can resolve the ack on that node; every
/// other node applies the op and ignores the tag.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ReplEntry {
    pub origin: u64,
    pub req_id: u64,
    pub op: LogOp,
}

impl Entry for ReplEntry {
    type Snapshot = NoSnapshot;
}

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

// ---------- apply outcomes (local, not serialized) ----------

/// Outcome of applying a decided `LogOp`, resolved to the pending HTTP request
/// on the origin node. Mirrors the single-node handlers' response cases.
#[derive(Clone, Debug)]
pub enum OpOutcome {
    Append(AppendApplyOutcome),
    Create(CreateApplyOutcome),
    Delete(DeleteApplyOutcome),
}

#[derive(Clone, Debug)]
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

#[derive(Clone, Debug)]
pub enum CreateApplyOutcome {
    Created { tail: u64, closed: bool },
    Exists { tail: u64, closed: bool, content_type: String },
    Conflict,
    /// Fork parent vanished between propose and apply.
    ForkSourceMissing,
    WriteFailed,
}

#[derive(Clone, Debug)]
pub enum DeleteApplyOutcome {
    Deleted,
    NotFound,
    Gone,
}
