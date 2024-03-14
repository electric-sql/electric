---
"@core/electric": patch
---

Create a publication in Postgres on startup. This would restore the replication stream from Postgres to Electric if the publication got deleted by accident.
