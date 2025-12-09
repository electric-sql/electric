---
'@core/sync-service': patch
---

Migrate Filter module and indexes from Elixir maps to ETS tables to reduce GC pressure when tracking large numbers of shapes.
