---
'@electric-ax/agents-server': patch
'@electric-ax/agents-runtime': patch
---

agents-server, agents-runtime: fix two first-spawn races that prevented writer-side shared-state entities from reaching their first handler run on a fresh tenant.

**agents-server**: `PUT /_electric/shared-state/<id>` now inserts the corresponding `shared_state_links` row synchronously whenever the request carries a valid `electric-owner-entity` header and the principal can access the entity. Previously this PUT only ran the authz check; the link row was created later — asynchronously — when the entity's manifest stream event was processed via `applyManifestEntitySource`. The runtime's `mkdb` wiring schedules the PUT and the preload GET back-to-back, so the GET always raced ahead of the eventually-consistent link insert and returned `401 UNAUTHORIZED: Principal is not allowed to read shared state` on every fresh-tenant first wake.

**agents-runtime**: `createChildDb` (used by entity observations) now swallows `Stream not found` / `404` on initial preload. A handler may legitimately observe an entity that hasn't been spawned yet — e.g. a parent observes its own future child to wake on the child's `runFinished`. Treating the 404 as "no events yet" matches the spirit of the observation (we'll be woken when the entity appears); the previous unconditional throw aborted the entire wake with `HTTP Error 404 ... Stream not found`, and the entity could never recover because the spawn that would create the child never ran.

Verified end-to-end with OpenFactory's `daily-digest` entity (uses `mkdb` + `observe(db(...))` + `observe(entity(<future child>))`) against a freshly torn-down local agents-server: the first `run-now` now writes the digest row, the discord-router subscriber picks it up, and the digest reaches Discord — without manual SQL or out-of-band link bootstrapping.
