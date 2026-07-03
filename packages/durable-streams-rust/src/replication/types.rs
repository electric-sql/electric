//! openraft type wiring: `LogOp` in, `OpOutcome` out.

use std::io::Cursor;

use super::entry::{LogOp, OpOutcome};

// Cursor is referenced by the declare_raft_types! expansion (SnapshotData).
#[allow(unused_imports)]
use Cursor as _Cursor;

pub type NodeId = u64;

openraft::declare_raft_types!(
    /// D = the replicated op, R = the apply outcome (resolved by client_write).
    /// Defaults: NodeId = u64, Node = BasicNode, Entry = Entry<TypeConfig>,
    /// SnapshotData = Cursor<Vec<u8>>, AsyncRuntime = TokioRuntime.
    pub TypeConfig:
        D = LogOp,
        R = OpOutcome,
);

pub type Raft = openraft::Raft<TypeConfig>;
pub type Entry = openraft::Entry<TypeConfig>;

pub mod typ {
    use openraft::BasicNode;

    use super::NodeId;
    use super::TypeConfig;

    pub type RaftError<E = openraft::error::Infallible> = openraft::error::RaftError<NodeId, E>;
    pub type RPCError<E = openraft::error::Infallible> =
        openraft::error::RPCError<NodeId, BasicNode, RaftError<E>>;
    pub type ClientWriteError = openraft::error::ClientWriteError<NodeId, BasicNode>;
    pub type ClientWriteResponse = openraft::raft::ClientWriteResponse<TypeConfig>;
}
