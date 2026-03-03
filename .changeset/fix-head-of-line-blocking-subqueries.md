---
'@core/sync-service': patch
---

Fix head-of-line blocking in ShapeLogCollector for shapes with subqueries. Shapes using `IN (SELECT ...)` clauses were causing 6–14 second SLC stalls under load due to O(N×D) serialised GenServer calls to Materializer. Replaced with concurrent ETS reads via a per-stack link-values cache, and added an inverted index in Filter so dep-shape record changes bypass the O(N) other_shapes scan.
