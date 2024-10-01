---
"@core/sync-service": patch
---

- Wait for advisory lock on replication slot to enable rolling deploys.
- Configurable replication slot and publication name using `REPLICATION_STREAM_ID` environment variable.
- Add `HealthCheckPlug` API endopint at `v1/health` that returns `waiting`, `starting`,and `active` statuses.