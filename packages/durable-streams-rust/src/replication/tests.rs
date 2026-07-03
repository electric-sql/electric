//! Multi-node replication tests: three full consensus cores (real TCP mesh on
//! loopback ephemeral ports, real stores on disk) inside one tokio runtime.
//! These exercise propose → forward → decide → apply → ack end to end; the
//! HTTP layer on top is covered by the deploy smoke script.

use std::sync::Arc;
use std::time::Duration;

use super::entry::{
    AppendApplyOutcome, CreateApplyOutcome, DeleteApplyOutcome, LogOp, OpOutcome, ReplProducer,
};
use super::{start_with_listener, ReplConfig, ReplHandle};
use crate::store::{Store, StreamConfig};
use crate::tier::TierConfig;

/// A unique temp data dir for one node of one test.
fn tmp(tag: &str, node: u64) -> std::path::PathBuf {
    use std::time::{SystemTime, UNIX_EPOCH};
    let p = std::env::temp_dir().join(format!(
        "ds-repl-{tag}-{node}-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let _ = std::fs::remove_dir_all(&p);
    p
}

struct Cluster {
    nodes: Vec<(Arc<Store>, Arc<ReplHandle>)>,
}

/// Boot an n-node cluster on ephemeral loopback ports and wait for a leader.
async fn cluster(tag: &str, n: u64) -> Cluster {
    let mut listeners = Vec::new();
    let mut peers = Vec::new();
    for id in 1..=n {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        peers.push((id, l.local_addr().unwrap().to_string()));
        listeners.push(l);
    }
    let mut nodes = Vec::new();
    for (i, listener) in listeners.into_iter().enumerate() {
        let id = i as u64 + 1;
        let store = Arc::new(
            Store::new_with_tier(tmp(tag, id), TierConfig::default()).expect("store init"),
        );
        let cfg = ReplConfig {
            id,
            peers: peers.clone(),
            listen: String::new(), // pre-bound listener supplied below
            ack_timeout: Duration::from_secs(10),
            trim_secs: 1,
            stats_secs: 0,
        };
        let handle = start_with_listener(Arc::clone(&store), &cfg, listener);
        nodes.push((store, handle));
    }
    // Wait for an agreed leader everywhere (election timeout is 500 ms).
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    loop {
        let leaders: Vec<u64> = nodes
            .iter()
            .map(|(_, h)| h.leader.load(std::sync::atomic::Ordering::Relaxed))
            .collect();
        if leaders.iter().all(|l| *l != 0) && leaders.windows(2).all(|w| w[0] == w[1]) {
            break;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "no leader elected: {leaders:?}"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    Cluster { nodes }
}

fn plain_config() -> StreamConfig {
    StreamConfig {
        content_type: "application/octet-stream".to_string(),
        ttl_seconds: None,
        expires_at: None,
        expires_at_raw: None,
        create_closed: false,
        forked_from: None,
        fork_offset_raw: None,
        fork_sub_offset: None,
    }
}

fn create_op(path: &str) -> LogOp {
    LogOp::Create {
        path: path.to_string(),
        config: plain_config(),
        base_offset: 0,
        wire: vec![],
    }
}

fn append_op(path: &str, bytes: &[u8]) -> LogOp {
    LogOp::Append {
        path: path.to_string(),
        wire: bytes.to_vec(),
        producer: None,
        seq: None,
        close: false,
    }
}

/// Wait until every node's store shows `path` at `tail` (decided entries apply
/// asynchronously on non-origin nodes).
async fn wait_converged(cl: &Cluster, path: &str, tail: u64) {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    loop {
        let tails: Vec<Option<u64>> = cl
            .nodes
            .iter()
            .map(|(s, _)| s.get(path).map(|st| st.tail().bytes))
            .collect();
        if tails.iter().all(|t| *t == Some(tail)) {
            return;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "no convergence on {path} at {tail}: {tails:?}"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn append_replicates_to_all_nodes_and_any_node_proposes() {
    let cl = cluster("basic", 3).await;
    let path = "/repl-basic";

    // Create via node 1.
    let out = cl.nodes[0].1.propose_and_wait(create_op(path)).await.unwrap();
    assert!(
        matches!(
            out,
            OpOutcome::Create(CreateApplyOutcome::Created { tail: 0, .. })
        ),
        "unexpected create outcome: {out:?}"
    );

    // Append via node 2 and node 3 (follower proposals forward to the leader).
    let out = cl.nodes[1].1.propose_and_wait(append_op(path, b"hello ")).await.unwrap();
    assert!(
        matches!(out, OpOutcome::Append(AppendApplyOutcome::Applied { tail: 6, .. })),
        "unexpected append outcome: {out:?}"
    );
    let out = cl.nodes[2].1.propose_and_wait(append_op(path, b"world")).await.unwrap();
    assert!(
        matches!(out, OpOutcome::Append(AppendApplyOutcome::Applied { tail: 11, .. })),
        "unexpected append outcome: {out:?}"
    );

    // Every replica converges to identical bytes.
    wait_converged(&cl, path, 11).await;
    for (store, _) in &cl.nodes {
        let st = store.get(path).unwrap();
        let bytes = crate::handlers::read_range_bytes(&st, 0, 11).await.unwrap();
        assert_eq!(&bytes[..], b"hello world");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn producer_dedup_is_replicated() {
    let cl = cluster("dedup", 3).await;
    let path = "/repl-dedup";
    cl.nodes[0].1.propose_and_wait(create_op(path)).await.unwrap();

    let with_producer = |seq: u64| LogOp::Append {
        path: path.to_string(),
        wire: b"x".to_vec(),
        producer: Some(ReplProducer {
            id: "p1".to_string(),
            epoch: 0,
            seq,
        }),
        seq: None,
        close: false,
    };

    let out = cl.nodes[0].1.propose_and_wait(with_producer(0)).await.unwrap();
    assert!(matches!(
        out,
        OpOutcome::Append(AppendApplyOutcome::Applied { tail: 1, .. })
    ));
    // The SAME (producer, epoch, seq) again — even via a different node — is a
    // duplicate: acknowledged without a second append.
    let out = cl.nodes[1].1.propose_and_wait(with_producer(0)).await.unwrap();
    assert!(
        matches!(
            out,
            OpOutcome::Append(AppendApplyOutcome::ProducerDuplicate { last_seq: 0, .. })
        ),
        "expected duplicate, got {out:?}"
    );
    wait_converged(&cl, path, 1).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn close_and_delete_replicate() {
    let cl = cluster("close-del", 3).await;
    let path = "/repl-close";
    cl.nodes[0].1.propose_and_wait(create_op(path)).await.unwrap();
    let out = cl.nodes[0]
        .1
        .propose_and_wait(LogOp::Append {
            path: path.to_string(),
            wire: b"bye".to_vec(),
            producer: None,
            seq: None,
            close: true,
        })
        .await
        .unwrap();
    assert!(matches!(
        out,
        OpOutcome::Append(AppendApplyOutcome::Applied { tail: 3, closed: true })
    ));
    wait_converged(&cl, path, 3).await;
    // Every replica observes the closure.
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        if cl.nodes.iter().all(|(s, _)| s.get(path).unwrap().tail().closed) {
            break;
        }
        assert!(tokio::time::Instant::now() < deadline, "closure did not replicate");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    // Appending to the closed stream via another node conflicts deterministically.
    let out = cl.nodes[2].1.propose_and_wait(append_op(path, b"z")).await.unwrap();
    assert!(matches!(
        out,
        OpOutcome::Append(AppendApplyOutcome::Closed { tail: 3 })
    ));

    // Delete replicates.
    let out = cl.nodes[1]
        .1
        .propose_and_wait(LogOp::Delete {
            path: path.to_string(),
        })
        .await
        .unwrap();
    assert!(matches!(out, OpOutcome::Delete(DeleteApplyOutcome::Deleted)));
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        let all_gone = cl.nodes.iter().all(|(s, _)| match s.get(path) {
            None => true,
            Some(st) => st.shared.read().unwrap().soft_deleted,
        });
        if all_gone {
            break;
        }
        assert!(tokio::time::Instant::now() < deadline, "delete did not replicate");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn initial_body_and_fork_offsets_replicate() {
    let cl = cluster("fork", 3).await;
    // Create with an initial body.
    let out = cl.nodes[0]
        .1
        .propose_and_wait(LogOp::Create {
            path: "/src".to_string(),
            config: plain_config(),
            base_offset: 0,
            wire: b"0123456789".to_vec(),
        })
        .await
        .unwrap();
    assert!(matches!(
        out,
        OpOutcome::Create(CreateApplyOutcome::Created { tail: 10, .. })
    ));
    wait_converged(&cl, "/src", 10).await;

    // Fork at offset 4 (pre-resolved by the proposing node, as the handler does).
    let mut fork_cfg = plain_config();
    fork_cfg.forked_from = Some("/src".to_string());
    fork_cfg.fork_offset_raw = Some("4".to_string());
    let out = cl.nodes[1]
        .1
        .propose_and_wait(LogOp::Create {
            path: "/fork".to_string(),
            config: fork_cfg,
            base_offset: 4,
            wire: vec![],
        })
        .await
        .unwrap();
    assert!(matches!(
        out,
        OpOutcome::Create(CreateApplyOutcome::Created { tail: 4, .. })
    ));
    // The fork reads through to the parent on every node.
    wait_converged(&cl, "/fork", 4).await;
    for (store, _) in &cl.nodes {
        let st = store.get("/fork").unwrap();
        let bytes = crate::handlers::read_range_bytes(&st, 0, 4).await.unwrap();
        assert_eq!(&bytes[..], b"0123");
    }
}
