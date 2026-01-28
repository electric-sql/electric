---
'@core/sync-service': patch
---

Fix Materializer startup race condition that caused "Key already exists" crashes

The Materializer subscribed to the Consumer before reading from storage, creating a window where the same record could be delivered twice (via storage AND via new_changes). Now the Consumer returns its current offset on subscription, and the Materializer reads storage only up to that offset.
