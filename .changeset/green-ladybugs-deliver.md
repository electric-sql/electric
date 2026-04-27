---
'@core/elixir-client': minor
'@core/sync-service': minor
---

Add Move-in/out support for subqueries combined using `AND`, `OR`, `NOT`, and other compound `WHERE` expressions. Previously these shapes would return `409` on a subquery move, forcing clients to discard the shape and resync it from scratch. The sync service now reconciles those changes in-stream.

This release also changes the wire protocol. Older `@core/elixir-client` versions are not compatible with the sync service from this release. TanStack DB clients need `@tanstack/db >= 0.6.2` and `@tanstack/electric-db-collection >= 0.3.0`.
