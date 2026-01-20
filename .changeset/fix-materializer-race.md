---
"@core/sync-service": patch
---

Fix race condition in Materializer startup where the Materializer would crash if the Consumer died during `await_snapshot_start` or `subscribe_materializer` calls. The Materializer now handles GenServer.call exits gracefully and shuts down cleanly.
