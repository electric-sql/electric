---
'@core/sync-service': patch
---

Modify `PublicationManager` to commit individual relation configurations while concurrently handling shape registrations to avoid timing out or blocking when updating high number of relations.
