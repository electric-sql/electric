---
'@core/sync-service': patch
---

Reduce the memory footprint of the subquery filter index. The per-value ETS
rows that back subquery routing and exact membership repeated several boxed
terms in their keys — the shape handle, `make_ref/0` condition references, the
canonical `["$sublink", "<dep>"]` subquery ref, and the `{condition_id, field}`
node id. Each of those is now a compact integer id, leaving only the actual
typed value boxed. This cuts the cost per seeded subquery membership value by
~51% (e.g. ~568 MiB → ~275 MiB for 1,000,000 seeded values) with no change to
routing behaviour.
