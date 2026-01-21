---
"@core/sync-service": patch
---

Fix RelationTracker not syncing with Configurator after restart

When the RelationTracker restarts while the Configurator is still running, it now properly notifies the Configurator of the restored filters. Previously, after a RelationTracker restart, subsequent shape removals would not update the publication because the internal filter state was inconsistent.
