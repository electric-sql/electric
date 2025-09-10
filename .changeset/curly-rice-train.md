---
"@core/sync-service": patch
---

Split pg connections across two pools so that high demand for snapshots doesn't interfere with the ability to introspect tables, configure the publication or monitor the WAL size
