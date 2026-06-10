---
'@electric-ax/agents-runtime': patch
'@electric-ax/agents-server': patch
'@electric-ax/agents': patch
'@electric-ax/agents-desktop': patch
---

Add pg-sync observation source enabling agents to observe Electric Postgres shape streams and wake on matching row changes (insert/update/delete). Includes server-side bridge management with cursor persistence, durable stream forwarding, and an `observe_pg_sync` tool for Horton agents.
