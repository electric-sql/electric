//! TCP mesh between replicas: one outbound connection per peer with automatic
//! reconnect; frames are `u32-BE length + bincode(Message<ReplEntry>)`. Losing
//! a link (or dropping queued messages while a peer is down) is safe —
//! OmniPaxos's resend timer reissues anything unacknowledged.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use omnipaxos::messages::Message;
use omnipaxos::util::NodeId;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;

use super::entry::ReplEntry;

/// Cap on a single frame (a batched Accept can carry many appends; 256 MiB is
/// far above any sane batch and small enough to reject stray/corrupt frames).
const MAX_FRAME: u32 = 256 * 1024 * 1024;
/// Per-peer outbound queue. Overflow drops (peer down / stalled) — resends cover it.
const OUTBOX_DEPTH: usize = 4096;
const RECONNECT_BACKOFF: Duration = Duration::from_millis(500);

pub(super) struct Mesh {
    outboxes: HashMap<NodeId, mpsc::Sender<Message<ReplEntry>>>,
    /// Live state of each outbound link, for `/_repl/status`.
    pub connected: HashMap<NodeId, Arc<AtomicBool>>,
}

impl Mesh {
    /// Route one outgoing consensus message. Messages to unknown receivers or
    /// full/down links are dropped (OmniPaxos resends).
    pub fn send(&self, msg: Message<ReplEntry>) {
        if let Some(tx) = self.outboxes.get(&msg.get_receiver()) {
            let _ = tx.try_send(msg);
        }
    }
}

/// Spawn the accept loop (feeding `incoming_tx`) and one reconnecting sender
/// task per peer. `listener` is pre-bound so tests can use ephemeral ports.
pub(super) fn spawn(
    listener: TcpListener,
    peers: &[(NodeId, String)],
    self_id: NodeId,
    incoming_tx: mpsc::Sender<Message<ReplEntry>>,
) -> Mesh {
    tokio::spawn(accept_loop(listener, incoming_tx));

    let mut outboxes = HashMap::new();
    let mut connected = HashMap::new();
    for (id, addr) in peers {
        if *id == self_id {
            continue;
        }
        let (tx, rx) = mpsc::channel(OUTBOX_DEPTH);
        let up = Arc::new(AtomicBool::new(false));
        tokio::spawn(peer_sender(addr.clone(), rx, Arc::clone(&up)));
        outboxes.insert(*id, tx);
        connected.insert(*id, up);
    }
    Mesh { outboxes, connected }
}

async fn accept_loop(listener: TcpListener, incoming_tx: mpsc::Sender<Message<ReplEntry>>) {
    loop {
        match listener.accept().await {
            Ok((sock, _)) => {
                let tx = incoming_tx.clone();
                tokio::spawn(async move {
                    let _ = read_frames(sock, tx).await;
                });
            }
            Err(_) => tokio::time::sleep(RECONNECT_BACKOFF).await,
        }
    }
}

async fn read_frames(
    mut sock: TcpStream,
    tx: mpsc::Sender<Message<ReplEntry>>,
) -> std::io::Result<()> {
    let mut len_buf = [0u8; 4];
    loop {
        sock.read_exact(&mut len_buf).await?;
        let len = u32::from_be_bytes(len_buf);
        if len == 0 || len > MAX_FRAME {
            return Ok(()); // corrupt/hostile frame: drop the connection
        }
        let mut buf = vec![0u8; len as usize];
        sock.read_exact(&mut buf).await?;
        let Ok(msg) = bincode::deserialize::<Message<ReplEntry>>(&buf) else {
            return Ok(());
        };
        if tx.send(msg).await.is_err() {
            return Ok(()); // core gone (shutdown)
        }
    }
}

async fn peer_sender(
    addr: String,
    mut rx: mpsc::Receiver<Message<ReplEntry>>,
    up: Arc<AtomicBool>,
) {
    loop {
        let mut sock = loop {
            match TcpStream::connect(&addr).await {
                Ok(s) => {
                    let _ = s.set_nodelay(true);
                    break s;
                }
                Err(_) => {
                    up.store(false, Ordering::Relaxed);
                    // Drain (drop) queued messages while down so the queue holds
                    // fresh traffic when the link returns; resends re-cover them.
                    while rx.try_recv().is_ok() {}
                    tokio::time::sleep(RECONNECT_BACKOFF).await;
                }
            }
        };
        up.store(true, Ordering::Relaxed);
        while let Some(msg) = rx.recv().await {
            let Ok(bytes) = bincode::serialize(&msg) else {
                continue;
            };
            let len = (bytes.len() as u32).to_be_bytes();
            if sock.write_all(&len).await.is_err() || sock.write_all(&bytes).await.is_err() {
                up.store(false, Ordering::Relaxed);
                break; // reconnect
            }
        }
        if rx.is_closed() && rx.try_recv().is_err() {
            return; // core gone (shutdown)
        }
    }
}
