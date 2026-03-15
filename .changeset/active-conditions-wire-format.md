---
'@core/sync-service': patch
'@core/elixir-client': patch
---

Introduce `active_conditions` wire format for DNF-based visibility tracking. The server now includes `active_conditions` in change headers for shapes with subqueries, and the Elixir client handles position-based tag indexing and disjunctive normal form (DNF) visibility evaluation. This is a backward-compatible protocol addition preparing for OR/NOT support in WHERE clauses.
