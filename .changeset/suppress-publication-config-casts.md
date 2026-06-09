---
'@core/sync-service': patch
---

Suppress redundant publication-configuration casts while a submission is already in flight. Under a burst of shape arrivals the publication manager's RelationTracker no longer mints one Configurator cast per add_shape/remove_shape, preventing the `publication_manager_configurator` mailbox from growing unboundedly (issue #4396).
