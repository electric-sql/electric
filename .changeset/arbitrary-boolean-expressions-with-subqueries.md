---
"@core/sync-service": minor
"@core/elixir-client": minor
---

Add support for arbitrary boolean expressions with subqueries.

Previously, WHERE clauses with OR or NOT combined with subqueries would cause shape invalidation. This update implements RFC "Arbitrary Boolean Expressions with Subqueries" which enables:

- OR with multiple subqueries: `WHERE project_id IN (SELECT ...) OR assigned_to IN (SELECT ...)`
- NOT with subqueries: `WHERE project_id NOT IN (SELECT ...)`
- Complex expressions: `WHERE (a IN sq1 AND b='x') OR c NOT IN sq2`

Key features:
- DNF (Disjunctive Normal Form) decomposition for WHERE clause analysis
- `active_conditions` array in row messages indicating which atomic conditions are satisfied
- Position-based move-in/move-out handling that correctly inverts behavior for negated positions
- Deduplication logic to prevent duplicate inserts when rows match multiple disjuncts
- Updated elixir-client to parse `active_conditions` field in message headers
