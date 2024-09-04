---
"@electric-sql/client": patch
---

Expose a `lastSyncedAt` field on the `ShapeStream` and `Shape` classes which is the time elapsed since the last sync with Electric (in milliseconds).
