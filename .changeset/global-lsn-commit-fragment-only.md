---
"@core/sync-service": patch
---

Only advance the global last seen LSN on commit-bearing transaction fragments. Large transactions are split into multiple fragments that all carry the transaction's final LSN, so a `up-to-date` response could previously advertise an LSN whose changes were not yet readable in the shape logs, and a later response could then return data at that same LSN.
