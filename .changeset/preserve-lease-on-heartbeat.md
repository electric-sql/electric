---
'@electric-ax/agents-server': patch
---

Fix `materializeHeartbeatClaim` nulling out `consumer_claims.lease_expires_at` when called without a lease argument. The heartbeat path is now an alive-ping only — it updates `last_heartbeat_at` and leaves the lease (set at claim materialization time from the upstream `lease_ttl_ms`) intact. Callers that genuinely want to extend the lease can still pass `leaseExpiresAt` explicitly.
