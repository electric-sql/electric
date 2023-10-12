---
"create-electric-app": patch
---

Update the `db:psql` script to connect to the database using `psql` running inside of the postgres container.

This lifts the requirement of having a Postgres client installed on the host OS.
