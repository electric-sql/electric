# Investigation: Shape Invalidation vs Incremental Updates

## Summary

The bug report is **accurate in all material claims**. Every code reference was verified
against the current codebase at HEAD (`20e151b`), including commit `586bd4c` which exists
in this repository.

## Verified Claims

### 1. The `should_invalidate?` Decision Logic

The decision point at `packages/sync-service/lib/electric/shapes/consumer.ex:294-296`:

```elixir
should_invalidate? =
  not tagged_subqueries_enabled? or state.or_with_subquery? or state.not_with_subquery? or
    length(state.shape.shape_dependencies) > 1
```

All four conditions are correctly documented. When `should_invalidate?` evaluates to `true`,
`stop_and_clean/1` (line 653) terminates the consumer process, triggering full shape
destruction and a 409 response to the client.

### 2. OR-with-Subquery Detection

The detection in `packages/sync-service/lib/electric/shapes/consumer/state.ex:150-168`
walks the WHERE clause AST looking for `"or"` function nodes containing `$sublink`
references. This is computed once at shape creation in `State.new/3` (line 145).

For the reporter's WHERE clause pattern:

```sql
WHERE organization_id = $ORG
AND (
  resource_owner_user_id = $USER
  OR id IN (SELECT task_id FROM task_user_acl ...)
  OR id IN (SELECT task_id FROM task_organization_acl ...)
)
```

The AST contains an `"or"` node with `$sublink` references, so `or_with_subquery? = true`.

### 3. Multiple Dependencies Also Triggers Invalidation

The same WHERE clause references two subquery tables (`task_user_acl` and
`task_organization_acl`), producing `length(shape_dependencies) = 2 > 1`. This
independently triggers invalidation.

**The reporter's shapes fail on two independent conditions.**

### 4. No Workaround Exists in Current Code

- No alternative code path for incremental updates when `or_with_subquery?` is true
- No feature flag beyond `tagged_subqueries` that could help
- The `MoveHandling` module is only reached when `should_invalidate? = false`

## Multi-Subquery Support Status

Several TODOs indicate planned work:

| File | Line | Comment |
|------|------|---------|
| `consumer/move_handling.ex` | 85 | "I'll be refactoring this code path for the multi-subqueries shortly" |
| `consumer/move_ins.ex` | 79 | "this assumes a single subquery for now" |
| `shape/subquery_moves.ex` | 101 | "This makes the assumption of only one column per pattern" |
| `shape/subquery_moves.ex` | 173 | "For multiple subqueries this should be a DNF form" |
| `shape/subquery_moves.ex` | 84 | Guard clause `[_]` limits to one dependency |

These are aspirational. The code currently hard-limits to single subqueries. The
`make_move_out_control_message/4` function in `subquery_moves.ex:84` uses a guard `[_]`
that explicitly accepts only one dependency.

## Assessment of Proposed Options

### Option 1: Default `shareWithOrg=false`
**Correctly identified as frequency reduction, not a fix.** The user's own shapes still
invalidate on any ACL write.

### Option 2: Unified `task_access` table
**Correct analysis.** Fixes `tasks` shape fully (single dep, no OR) but child shapes retain
the `resource_owner_user_id = $USER OR task_id IN (...)` pattern (OR+subquery). Row
explosion concern is legitimate.

### Option 3: Per-table access tables
**Correctly identified as excessive.** Multiplicative maintenance burden.

### Option 4: Org-scoped shapes with client-side filtering
**Simplest path to zero invalidation.** The `online_hosts` comparison (5 shape creations/24h
vs 72 for `artifacts`) provides strong empirical evidence. Since `shareWithOrg` defaults to
`true` (all data already visible to org members), the security tradeoff may be acceptable.

### Option 5: Owned/shared shape split
**Correct that owned shapes never invalidate** (no subqueries for
`resource_owner_user_id = $USER`). Combining with Option 4 for the shared collection
eliminates invalidation entirely.

### Option 6: Electric team collaboration
**Worth pursuing.** TODOs indicate multi-subquery support is planned. Understanding the
timeline would inform long-term strategy.

## Additional Observation: UNION Subquery (Potential Option 7)

The WHERE clause could potentially be restructured to avoid OR by using a single UNION
subquery:

```sql
WHERE organization_id = $ORG
AND id IN (
  SELECT task_id FROM task_user_acl
  WHERE subject_user_id = $USER AND organization_id = $ORG
  UNION
  SELECT task_id FROM task_organization_acl
  WHERE organization_id = $ORG
  UNION
  SELECT id FROM tasks
  WHERE resource_owner_user_id = $USER AND organization_id = $ORG
)
```

This would yield:
- `or_with_subquery?` = **false** (no OR wrapping the subquery)
- `length(shape_dependencies)` = **1** (single subquery, though it's a UNION)

**Caveat:** This depends on whether Electric's WHERE clause parser supports UNION
subqueries and treats the result as a single dependency. The `$sublink` mechanism would
need to handle UNION, which is not guaranteed. This needs investigation with the Electric
team (a variant of Option 6).

For child entities with nullable `task_id`, the same approach is more complex but may be
possible with COALESCE patterns.

## Recommended Priority

1. **Immediately**: Option 1 — flip `shareWithOrg` default (one line, reduces frequency)
2. **Short-term**: Option 4 — org-scoped shapes (simplest full fix, data already visible to
   org members via default sharing)
3. **In parallel**: Option 6 — engage Electric team on multi-subquery timeline and UNION
   subquery feasibility
4. **Fallback**: Option 5 — owned/shared split if Option 4 is rejected on security grounds
