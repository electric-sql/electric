---
"@core/electric": patch
---

Fix data encoding issues caused by unexpected cluster-wide or database-specific configuration in Postgres. Electric now overrides certain settings it is sensitive to when opening a new connection to the database.
