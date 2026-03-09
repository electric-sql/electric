---
'@core/sync-service': patch
---

Fix race condition in `ConsumerRegistry.unregister_name/1` that left stale PIDs in the ETS table. Uses atomic `:ets.match_delete/2` to remove the entry only if it still belongs to the dying process, preventing accidental deletion of a replacement consumer's entry.
