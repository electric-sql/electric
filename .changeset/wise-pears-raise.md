---
"@core/sync-service": patch
---

Add a configuration option ELECTRIC_MANUAL_TABLE_PUBLISHING. Setting it to true
disables Electric's automatic addition/removal of tables from the Postgres
publication.

This is useful when the database role that Electric uses to connect to Postgres
does not own user tables. Adding tables to the publication by hand and
setting their REPLICA IDENTITY to FULL allows Electric to stream changes from
them regardless.
