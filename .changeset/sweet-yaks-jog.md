---
"@electric-sql/client": minor
"@core/elixir-client": minor
"@core/sync-service": minor
"@electric-sql/docs": patch
---

feat!: change the wire protocol to remove `offset` and add an explicit `lsn` header. Only valid offset now is the one provided in headers
