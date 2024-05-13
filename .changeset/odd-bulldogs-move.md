---
"@core/electric": patch
---

fix: set `Postgrex` SSL mode based on the connection by `:epgsql` to keep `sslmode=prefer` behaviour when `DATABASE_REQUIRE_SSL` is not `true`.
