---
"@core/electric": patch
---

fix: disable automatic fallback from SSL to non-SSL DB connection because it didn't work for one of the connectors.

This also fixes application of the default value for requiring SSL, which was erroneously "false" before. This means that if your DB doesn't support SSL, you need to explicitly specify it via `DATABASE_REQUIRE_SSL=false` env variable or `?sslmode=disable` in the connection string.
