---
'@core/sync-service': patch
---

Under a thundering herd of `offset=-1` requests for the same not-yet-created shape, every caller used to enqueue a `GenServer.call` into the single per-stack `ShapeCache` mailbox and sit there for the full duration of one shape creation, even though the creation work itself was already deduplicated. ShapeCache now sets a public, GenServer-owned per-shape lock when it begins creating a shape; concurrent callers for that same shape skip the mailbox entirely and poll a cheap ETS/read-connection predicate via `Electric.PollWait` until the shape is activated. Mailbox growth for a hot new shape is now bounded by the brief window between the first call being queued and the handler setting the lock, instead of scaling with offered load.

If a creation fails, the leader publishes the error into the same lock table, so the polling waiters fail fast with the real reason rather than waiting out the call timeout — and still without any `GenServer.call` stampede. The published failure is swept after a short grace window so a later request for the same shape retries creation cleanly.
