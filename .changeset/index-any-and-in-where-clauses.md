---
'@core/sync-service': patch
---

Index `= ANY(array_field)` and `IN (const_list)` WHERE clause expressions for O(1) shape filtering. ANY clauses reuse the InclusionIndex (via single-element array containment), and IN clauses reuse the EqualityIndex (registering each value separately). At 1000 concurrent shapes, fan-out latency improves by 6x (ANY) and 15x (IN) compared to the previous linear scan.
