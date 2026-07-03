---
"@electric-ax/durable-streams-server-rust": minor
---

feat: `--durability replicated` — Kafka-style durability via quorum
replication (openraft) instead of local fsync. An append acks once a quorum
of replicas has committed and applied it; no fsync anywhere on the hot path.
Any node accepts writes (forward-to-leader with read-your-writes), every node
serves reads, log-first apply keeps replicas byte-identical through
fail-over. Includes restart-rejoin (durable vote + manifest snapshots with
mesh byte-fetch), live membership change (`/_repl/add-learner`,
`/_repl/change-membership`), `REPL_STATS`/`/_repl/status` observability, and
a 3-node deploy kit (`deploy/replicated/`: local cluster, docker compose,
k8s, smoke incl. leader-kill and restart-rejoin).
