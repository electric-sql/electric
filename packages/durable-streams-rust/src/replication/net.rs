//! RPC mesh between replicas: one persistent outbound connection per peer
//! with correlation ids and automatic reconnect; frames are
//! `u32-BE length + bincode((req_id, payload))`. Carries openraft's three
//! RPCs plus our forward-to-leader proposal RPC.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use openraft::error::{InstallSnapshotError, NetworkError, Unreachable};
use openraft::network::{RPCOption, RaftNetwork, RaftNetworkFactory};
use openraft::raft::{
    AppendEntriesRequest, AppendEntriesResponse, InstallSnapshotRequest, InstallSnapshotResponse,
    VoteRequest, VoteResponse,
};
use openraft::BasicNode;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{tcp::OwnedWriteHalf, TcpListener, TcpStream};
use tokio::sync::{mpsc, oneshot, Mutex};

use super::entry::{LogOp, OpOutcome};
use super::types::{typ, NodeId, Raft, TypeConfig};

const MAX_FRAME: u32 = 256 * 1024 * 1024;
const RECONNECT_BACKOFF: Duration = Duration::from_millis(500);
/// Cap on any single RPC round trip (openraft also applies its own ttls).
const RPC_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Serialize, Deserialize)]
pub(super) enum RpcRequest {
    Append(AppendEntriesRequest<TypeConfig>),
    Vote(VoteRequest<NodeId>),
    Snapshot(InstallSnapshotRequest<TypeConfig>),
    /// Proposal forwarded from a non-leader node: the leader runs
    /// `client_write` and returns the apply outcome + log index.
    Forward(LogOp),
}

#[derive(Serialize, Deserialize)]
pub(super) enum RpcReply {
    Append(Result<AppendEntriesResponse<NodeId>, String>),
    Vote(Result<VoteResponse<NodeId>, String>),
    Snapshot(Result<InstallSnapshotResponse<NodeId>, String>),
    Forward(Result<(OpOutcome, u64), String>),
}

// ---------- client ----------

struct Conn {
    tx: mpsc::Sender<Vec<u8>>,
    pending: Arc<dashmap::DashMap<u64, oneshot::Sender<RpcReply>>>,
}

/// A lazily-connected, auto-reconnecting RPC client for one peer.
pub(super) struct RpcClient {
    pub addr: String,
    conn: Mutex<Option<Conn>>,
    next_id: AtomicU64,
    pub connected: AtomicBool,
}

impl RpcClient {
    pub fn new(addr: String) -> Arc<Self> {
        Arc::new(RpcClient {
            addr,
            conn: Mutex::new(None),
            next_id: AtomicU64::new(1),
            connected: AtomicBool::new(false),
        })
    }

    async fn ensure_conn(&self) -> std::io::Result<(mpsc::Sender<Vec<u8>>, Arc<dashmap::DashMap<u64, oneshot::Sender<RpcReply>>>)>
    {
        let mut guard = self.conn.lock().await;
        if let Some(c) = guard.as_ref() {
            if !c.tx.is_closed() {
                return Ok((c.tx.clone(), Arc::clone(&c.pending)));
            }
        }
        let sock = TcpStream::connect(&self.addr).await?;
        let _ = sock.set_nodelay(true);
        let (mut rd, wr) = sock.into_split();
        let (tx, rx) = mpsc::channel::<Vec<u8>>(1024);
        let pending: Arc<dashmap::DashMap<u64, oneshot::Sender<RpcReply>>> =
            Arc::new(dashmap::DashMap::new());
        tokio::spawn(write_loop(wr, rx));
        let pending2 = Arc::clone(&pending);
        tokio::spawn(async move {
            // Reader: match replies to pending calls; on EOF/err fail them all
            // (their oneshot senders drop → callers see a network error).
            let mut len_buf = [0u8; 4];
            loop {
                if rd.read_exact(&mut len_buf).await.is_err() {
                    break;
                }
                let len = u32::from_be_bytes(len_buf);
                if len == 0 || len > MAX_FRAME {
                    break;
                }
                let mut buf = vec![0u8; len as usize];
                if rd.read_exact(&mut buf).await.is_err() {
                    break;
                }
                let Ok((req_id, reply)) = bincode::deserialize::<(u64, RpcReply)>(&buf) else {
                    break;
                };
                if let Some((_, tx)) = pending2.remove(&req_id) {
                    let _ = tx.send(reply);
                }
            }
            pending2.clear();
        });
        *guard = Some(Conn {
            tx: tx.clone(),
            pending: Arc::clone(&pending),
        });
        self.connected.store(true, Ordering::Relaxed);
        Ok((tx, pending))
    }

    pub async fn call(&self, req: RpcRequest) -> Result<RpcReply, std::io::Error> {
        let (tx, pending) = match self.ensure_conn().await {
            Ok(v) => v,
            Err(e) => {
                self.connected.store(false, Ordering::Relaxed);
                return Err(e);
            }
        };
        let req_id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (otx, orx) = oneshot::channel();
        pending.insert(req_id, otx);
        let mut frame = Vec::new();
        let body = bincode::serialize(&(req_id, req))
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        frame.extend_from_slice(&(body.len() as u32).to_be_bytes());
        frame.extend_from_slice(&body);
        if tx.send(frame).await.is_err() {
            pending.remove(&req_id);
            self.connected.store(false, Ordering::Relaxed);
            *self.conn.lock().await = None;
            return Err(std::io::Error::new(
                std::io::ErrorKind::BrokenPipe,
                "peer connection lost",
            ));
        }
        match tokio::time::timeout(RPC_TIMEOUT, orx).await {
            Ok(Ok(reply)) => Ok(reply),
            _ => {
                pending.remove(&req_id);
                self.connected.store(false, Ordering::Relaxed);
                *self.conn.lock().await = None;
                Err(std::io::Error::new(
                    std::io::ErrorKind::TimedOut,
                    "rpc timeout / connection lost",
                ))
            }
        }
    }
}

async fn write_loop(mut wr: OwnedWriteHalf, mut rx: mpsc::Receiver<Vec<u8>>) {
    while let Some(frame) = rx.recv().await {
        if wr.write_all(&frame).await.is_err() {
            return; // dropping rx closes the channel; callers reconnect
        }
    }
}

// ---------- openraft network adapter ----------

pub(super) struct MeshFactory {
    pub clients: std::collections::HashMap<NodeId, Arc<RpcClient>>,
}

pub(super) struct NodeClient {
    client: Arc<RpcClient>,
}

impl RaftNetworkFactory<TypeConfig> for MeshFactory {
    type Network = NodeClient;

    async fn new_client(&mut self, target: NodeId, _node: &BasicNode) -> Self::Network {
        NodeClient {
            client: Arc::clone(self.clients.get(&target).expect("unknown peer id")),
        }
    }
}

fn net_err<E>(e: std::io::Error) -> openraft::error::RPCError<NodeId, BasicNode, E>
where
    E: std::error::Error,
{
    if e.kind() == std::io::ErrorKind::ConnectionRefused {
        openraft::error::RPCError::Unreachable(Unreachable::new(&e))
    } else {
        openraft::error::RPCError::Network(NetworkError::new(&e))
    }
}

fn remote_err<E>(msg: String) -> openraft::error::RPCError<NodeId, BasicNode, E>
where
    E: std::error::Error,
{
    let e = std::io::Error::other(msg);
    openraft::error::RPCError::Network(NetworkError::new(&e))
}

impl RaftNetwork<TypeConfig> for NodeClient {
    async fn append_entries(
        &mut self,
        req: AppendEntriesRequest<TypeConfig>,
        _option: RPCOption,
    ) -> Result<AppendEntriesResponse<NodeId>, typ::RPCError> {
        match self.client.call(RpcRequest::Append(req)).await {
            Ok(RpcReply::Append(Ok(resp))) => Ok(resp),
            Ok(RpcReply::Append(Err(m))) => Err(remote_err(m)),
            Ok(_) => Err(remote_err("mismatched rpc reply".into())),
            Err(e) => Err(net_err(e)),
        }
    }

    async fn install_snapshot(
        &mut self,
        req: InstallSnapshotRequest<TypeConfig>,
        _option: RPCOption,
    ) -> Result<InstallSnapshotResponse<NodeId>, typ::RPCError<InstallSnapshotError>> {
        match self.client.call(RpcRequest::Snapshot(req)).await {
            Ok(RpcReply::Snapshot(Ok(resp))) => Ok(resp),
            Ok(RpcReply::Snapshot(Err(m))) => Err(remote_err(m)),
            Ok(_) => Err(remote_err("mismatched rpc reply".into())),
            Err(e) => Err(net_err(e)),
        }
    }

    async fn vote(
        &mut self,
        req: VoteRequest<NodeId>,
        _option: RPCOption,
    ) -> Result<VoteResponse<NodeId>, typ::RPCError> {
        match self.client.call(RpcRequest::Vote(req)).await {
            Ok(RpcReply::Vote(Ok(resp))) => Ok(resp),
            Ok(RpcReply::Vote(Err(m))) => Err(remote_err(m)),
            Ok(_) => Err(remote_err("mismatched rpc reply".into())),
            Err(e) => Err(net_err(e)),
        }
    }
}

// ---------- server ----------

/// Accept loop: serve openraft RPCs + forwarded proposals against the local
/// Raft. Each request runs as its own task so a slow apply (Forward) doesn't
/// head-of-line-block heartbeats on the same connection.
pub(super) fn spawn_server(listener: TcpListener, raft: Raft) {
    tokio::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((sock, _)) => {
                    let _ = sock.set_nodelay(true);
                    let raft = raft.clone();
                    tokio::spawn(serve_conn(sock, raft));
                }
                Err(_) => tokio::time::sleep(RECONNECT_BACKOFF).await,
            }
        }
    });
}

async fn serve_conn(sock: TcpStream, raft: Raft) {
    let (mut rd, wr) = sock.into_split();
    let (tx, rx) = mpsc::channel::<Vec<u8>>(1024);
    tokio::spawn(write_loop(wr, rx));
    let mut len_buf = [0u8; 4];
    loop {
        if rd.read_exact(&mut len_buf).await.is_err() {
            return;
        }
        let len = u32::from_be_bytes(len_buf);
        if len == 0 || len > MAX_FRAME {
            return;
        }
        let mut buf = vec![0u8; len as usize];
        if rd.read_exact(&mut buf).await.is_err() {
            return;
        }
        let Ok((req_id, req)) = bincode::deserialize::<(u64, RpcRequest)>(&buf) else {
            return;
        };
        let raft = raft.clone();
        let tx = tx.clone();
        tokio::spawn(async move {
            let reply = handle_rpc(&raft, req).await;
            let Ok(body) = bincode::serialize(&(req_id, reply)) else {
                return;
            };
            let mut frame = Vec::with_capacity(4 + body.len());
            frame.extend_from_slice(&(body.len() as u32).to_be_bytes());
            frame.extend_from_slice(&body);
            let _ = tx.send(frame).await;
        });
    }
}

async fn handle_rpc(raft: &Raft, req: RpcRequest) -> RpcReply {
    match req {
        RpcRequest::Append(r) => {
            RpcReply::Append(raft.append_entries(r).await.map_err(|e| e.to_string()))
        }
        RpcRequest::Vote(r) => RpcReply::Vote(raft.vote(r).await.map_err(|e| e.to_string())),
        RpcRequest::Snapshot(r) => {
            RpcReply::Snapshot(raft.install_snapshot(r).await.map_err(|e| e.to_string()))
        }
        RpcRequest::Forward(op) => RpcReply::Forward(
            raft.client_write(op)
                .await
                .map(|resp| (resp.data, resp.log_id.index))
                .map_err(|e| e.to_string()),
        ),
    }
}
