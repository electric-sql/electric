---
'@core/sync-service': patch
---

Fix: Return 409 on move-ins/outs for where clauses of the form 'NOT IN (subquery)' since this is not supported yet
