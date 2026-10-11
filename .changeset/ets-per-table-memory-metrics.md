---
'@core/electric-telemetry': patch
---

Emit per-individual-table ETS memory/size telemetry (`ets.table.memory` and `ets.table.size`, tagged by `table_name` and `table_type`) for the top N tables by memory, controlled by the new `top_ets_individual_count` option (default 10). Complements the existing per-`table_type` `ets.memory.total` aggregate.
