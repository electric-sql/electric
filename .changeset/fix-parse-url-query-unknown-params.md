---
'@core/sync-service': patch
---

Fix `parse_postgresql_uri` to ignore unknown query parameters instead of rejecting them. Previously, unknown params like `uselibpqcompat=true` were silently ignored when `sslmode` was present (due to Elixir map pattern matching) but rejected when alone. Now unknown params are always ignored, and only `sslmode` and `replication` are validated.
