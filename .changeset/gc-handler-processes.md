---
'@core/sync-service': patch
---

Reduce memory retention in Bandit handler processes by calling `:erlang.garbage_collect()` before entering the long-poll receive block, and add `ELECTRIC_TWEAKS_HANDLER_FULLSWEEP_AFTER` env var to control the `fullsweep_after` GC spawn option for handler processes.
