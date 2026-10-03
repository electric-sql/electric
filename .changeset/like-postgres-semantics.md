---
"@core/sync-service": patch
---

Fix `LIKE`/`ILIKE` to follow Postgres semantics: `%` and `_` now match newline characters, a trailing newline in the value is no longer ignored, and a backslash-escaped `%` or `_` matches the literal character instead of the wildcard (including the backslash).
