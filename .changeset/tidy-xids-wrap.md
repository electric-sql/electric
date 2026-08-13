---
"@electric-sql/client": patch
---

Fix subset snapshot filtering after PostgreSQL transaction ID wraparound and
retire filters once the stream passes each snapshot's database LSN.
