# Branch Review: `rob/arbitrary-boolean-expressions-with-subqueries`

## Overall Assessment

The implementation is **architecturally sound and comprehensive**. All 14 phases from the implementation plan are complete, and the code aligns well with both the plan and RFC. The key design decision — keeping DNF state in a separate `DnfContext` rather than modifying the `Shape` struct — is clean and well-executed.

Below are findings organized by category.

---

## Alignment with Plan & RFC

All 14 phases are implemented and match the plan's intent:

| Phase | Status | Notes |
|-------|--------|-------|
| 1. Decomposer | Complete | De Morgan's laws, complexity guard, position stability |
| 2. SqlGenerator | Complete | Comprehensive operator coverage with precedence |
| 3. DnfContext | Complete | Correct sublink index extraction from AST |
| 4. Shape tag_structure | Complete | Multi-disjunct, no new Shape fields |
| 5. Consumer State | Complete | Removed invalidation flags, holds DnfContext |
| 6. Active Conditions | Complete | Single-pass via `evaluate_record/4` |
| 7. Move Messages + Exclusion | Complete | DNF-aware exclusion clauses |
| 8. Log Items | Complete | 2D-to-wire conversion via `tags_to_wire/1` |
| 9. Change Handling | Complete | Uses DnfContext, replaces `includes_record?` |
| 10. Querying | Complete | `active_conditions` + `condition_hashes` SELECT |
| 11. Move Handling | Complete | Position-aware, negation inversion |
| 12. Position-aware moved_out_tags | Complete | Per-position filtering, storage version bump |
| 13. Remove Invalidation | Complete | `or_with_subquery?` / `not_with_subquery?` removed |
| 14. Elixir Client | Complete | Tag normalization, DNF visibility eval |

**Minor deviation**: The plan calls for `extract_sublink_index/1` to be "defined once in a shared location." In practice it's defined in both `dnf_context.ex` and `subquery_moves.ex`. Both use the same pattern-match on `$sublink` AST nodes, so correctness is fine, but there's a maintenance risk if the logic needs updating.

---

## Correctness Concerns

**1. `DnfContext.from_shape/1` silently returns `nil` on decomposer failure**

If `Decomposer.decompose/1` returns `{:error, _}`, the context is nil and the consumer silently falls back to legacy behavior. This shouldn't happen in practice (failures are caught at shape creation time with a 400), but there's no logging to understand if a shape that *should* have a DnfContext ends up without one at runtime.

**2. Exclusion clause generation (`build_dnf_exclusion_clauses/4`) lacks dedicated unit tests**

This is complex logic (partitioning disjuncts, generating `AND NOT (...)` clauses for non-containing disjuncts) tested only indirectly through oracle property tests. A bug here would cause incorrect move-in queries — either over-fetching (wasted work) or under-fetching (missed rows). The oracle tests likely catch this, but targeted unit tests would improve debuggability.

**3. Two-point decomposition is correct but undocumented in code**

The plan explicitly calls out that `Decomposer.decompose/1` is called at both shape creation and consumer startup, and that this is safe because decomposition is deterministic. The code does this correctly but doesn't include a comment explaining why the redundant call is intentional.

**4. Move event cancellation (`cancel_matching_move_events/1`) is correct**

The sorted-pair algorithm handles multiple occurrences of the same value correctly. The O(n log n) sort is acceptable for typical batch sizes.

---

## Potential Scaling Issues

**1. Exclusion clause SQL size — O(disjuncts x subqueries x subquery_SQL_size)**

Each non-containing disjunct generates an `AND NOT (cond1 AND cond2 ...)` clause where each condition can contain a full subquery. With the 100-disjunct limit:
- Worst case: ~50 exclusion disjuncts x 3 conditions x 200 chars = ~30KB of SQL per move-in query
- PostgreSQL can handle this (1GB query limit), but query planning time grows with SQL complexity
- **Practical risk**: Low. Real WHERE clauses typically produce 2-5 disjuncts.
- **Recommendation**: Monitor query plan times for shapes approaching the disjunct limit.

**2. Per-row `active_conditions` computation in replication stream**

Every row from the replication stream now evaluates `position_count` subexpressions (via `DnfContext.evaluate_record/4`) instead of a single `includes_record?` call. Each subexpression evaluation involves:
- Subquery positions: `MapSet.member?` lookup (O(1) amortized)
- Non-subquery positions: AST evaluation via `Runner.execute/3`

With `position_count` up to ~10 in realistic cases, this is a constant-factor overhead over the existing single-evaluation path. The plan acknowledges this replaces (not adds to) `includes_record?`, so it's a single pass, not double evaluation.

**Risk**: For shapes with many non-subquery positions, the AST evaluation overhead could add up on high-throughput replication streams. The existing `when not Shape.has_dependencies(shape)` guard ensures shapes without subqueries skip DNF entirely.

**3. Tag storage per row — O(disjuncts x positions)**

Each row carries:
- 2D tag array: `num_disjuncts x num_positions` entries (many nil)
- `active_conditions`: `num_positions` booleans

With 100 disjuncts x 10 positions = ~1000 entries per row. For batches of 1000 rows = ~1M entries. These are small values (hashes or booleans), so memory impact is negligible for realistic cases but could add up at the 100-disjunct limit.

**4. `condition_hashes_to_skip` accumulation during in-flight move-in queries**

`moved_out_tags` grows as move-outs arrive while move-in queries are in flight. The type changed from `%{name => MapSet}` to `%{name => %{position => MapSet}}`, adding one level of nesting. Filtering is O(positions x skip_set_size) per row, which is fine for typical cases.

**5. Snapshot query active_conditions SQL — O(positions x subquery_size)**

The snapshot SELECT includes `ARRAY[cond_0, cond_1, ..., cond_N]::boolean[]` where each `cond_i` can be a full subquery. PostgreSQL deduplicates identical subexpressions between SELECT and WHERE, but the query planner still needs to process them. For 10 positions with subqueries, this adds moderate overhead to snapshot queries.

**6. Binary snapshot file format overhead**

The new format stores `hash_count` condition hashes per row (one per position). With 10 positions x ~32 bytes per hash = ~320 extra bytes per row. For a 1M-row snapshot, this adds ~320MB. This is proportional and unavoidable, but worth monitoring for large shapes.

---

## RFC Compliance

The implementation matches the RFC on all key points:

- **DNF decomposition**: Correct De Morgan's laws, position assignment, complexity guard
- **Tag structure**: Three-format distinction (condition_hashes, internal 2D, wire) correctly implemented
- **Message format**: `active_conditions` added to headers, `tags_to_wire` conversion correct
- **Move-in queries**: Triggering-disjunct-only WHERE clause with exclusion clauses
- **Negation handling**: Positions store un-negated AST with `negated: true`, NOT applied at evaluation time
- **Protocol versioning**: V1 clients rejected for complex shapes, V2 required
- **Consistency model**: Eventual consistency for subquery shapes (pre-existing, correctly documented)
- **Client requirements**: Elixir client implements position-based indexing, DNF visibility evaluation, synthetic deletes

One area the RFC calls out as "future work" — restoring transactional/causal consistency by delaying up-to-date markers — is correctly deferred (not attempted on this branch).

---

## Summary of Recommendations

**High priority:**
1. Add dedicated unit tests for `build_dnf_exclusion_clauses/4` covering various disjunct combinations, negated positions, and mixed condition types
2. Add a code comment in `fill_tag_structure` explaining the intentional two-point decomposition

**Medium priority:**
3. Consolidate `extract_sublink_index/1` into a single shared location (or at minimum add a comment cross-referencing the copies)
4. Add logging in `DnfContext.from_shape/1` when decomposition fails (to catch unexpected nil contexts at runtime)
5. Monitor move-in query SQL size and plan time in production for shapes with many disjuncts

**Low priority:**
6. Consider a round-trip property test: WHERE -> parse -> SqlGenerator -> parse again -> assert equivalent ASTs
7. Document the exclusion clause algorithm inline (currently the most complex and least documented part of the codebase)
