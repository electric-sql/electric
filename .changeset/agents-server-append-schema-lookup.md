---
'@electric-ax/agents-server': patch
---

Resolve an entity's schemas once per stream append instead of once per appended event. A typed append of N events now costs two Postgres reads instead of N + 1, which cuts write latency when the database is not local.
