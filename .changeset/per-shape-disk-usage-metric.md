---
"@core/sync-service": patch
---

Emit a new `electric.storage.dir.bytes` stack-level metric reporting on-disk size for the top-N largest shapes (tagged by shape handle), computed during the existing periodic disk-usage walk so it adds no extra filesystem traversal.
