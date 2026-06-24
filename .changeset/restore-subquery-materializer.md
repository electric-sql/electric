---
'@core/sync-service': patch
---

Fix subquery shapes diverging from Postgres after a server restart. Shapes
whose where clause contains a subquery (e.g. `id IN (SELECT ... WHERE active)`)
could return stale results or a `409 must-refetch` once the stack restarted and
restored from disk. Two causes are addressed: the dependency materializer now
replays the full persisted history (snapshot + main log) on startup instead of
just the first chunk, and dependent (outer) subquery consumers are eagerly
restarted during restore so their materializer subscription is re-established
before live events flow.
