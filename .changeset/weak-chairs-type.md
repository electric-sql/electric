---
"@core/sync-service": patch
---

Store shape definitions along with shape data and use that to restore them instead of persisted cached metadata. This removes the unified serilization and persistence of all shape metadata and allows better scaling of speed of shape creation.
