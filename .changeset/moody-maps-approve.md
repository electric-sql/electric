---
'@core/sync-service': patch
---

Add Postgres concat(variadic text) to shape subset WHERE evaluation, with NULL arguments skipped and SqlGenerator support for concat(...) round-trips.
