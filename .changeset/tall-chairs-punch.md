---
"@core/sync-service": patch
---

Fix a possible deadlock issue when creating or updating multiple where-claused shapes that occured while updating the Postgres publication (only on PG 15+). Fix a possible race condition between reading the existing publication and writing the updated version.
