---
"electric-sql": patch
---

Fix a bug with Postgres client sync so that pk columns for creating the ON CONFLICT statement are correct when applying an incoming transaction.
