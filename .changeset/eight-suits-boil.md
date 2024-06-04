---
"@core/electric": patch
---

Bring back the enforcement of SSL use for database connections. The default value was changed to `false` in v0.9.1 by accident. This version restores the intended behaviour. To use unencrypted database connections, you must explicitly configure Electric with DATABASE_REQUIRE_SSL=false.
