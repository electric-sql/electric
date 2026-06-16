---
"@core/sync-service": patch
---

Bound Shape.Consumer heap growth: make the consumer family's process spawn options (incl. `fullsweep_after`) configurable per process via `ELECTRIC_PROCESS_SPAWN_OPTS`, and add an opt-in adaptive GC that runs after a transaction fragment when the consumer's heap exceeds the runtime-tunable `ELECTRIC_CONSUMER_GC_HEAP_THRESHOLD` (off by default).
