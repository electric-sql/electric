---
'@electric-ax/agents-server': patch
---

Fix pull-wake claims leaking in `consumer_claims` after dispatch. The release path in `callback-forward` was gated entirely on the in-memory write-token state, so any condition that lost or evicted the token (server restart, a newer wake on the same stream) would prevent `materializeReleasedClaim` from running and leave the DB row pinned at `status='active'`. The fix decouples the durable-row release (keyed by `consumerId + epoch`) from in-memory token cleanup, and uses `entityCleared || stillOwnsClaim` to gate the entity status transition back to `idle`. Includes regression tests in `test/webhook-forward-routing.test.ts`.
