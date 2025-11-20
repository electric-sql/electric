# Shape Cache Collision: Different `log_mode` Values Incorrectly Share Shape Handles

## Problem Description

We've discovered a critical bug where shapes with different `log_mode` values (`:full` vs `:changes_only`) but otherwise identical parameters are treated as the same shape by the shape cache. This causes data availability issues in production.

### Reported Symptoms (from Slack)

From Marius on staging:

> A shape doesn't return any data (it returns the up-to-date status, but it's definitely not up-to-date)

Key observations:
- Issue appeared after using on-demand mode (which uses `log=changes_only`)
- Clearing the cache through the cloud console temporarily fixed it
- Even on a branch where on-demand mode was disabled, shapes still exhibited `changes_only` behavior
- The shape returned `snapshot-end` but no data rows

## Root Cause Analysis

The `Shape.comparable()` function (`packages/sync-service/lib/electric/shapes/shape.ex:98-103`) is used as the cache key for shape lookups in ETS. Currently it includes:

- `root_table_id` / `root_table`
- `root_pk`
- `where` clause
- `selected_columns`
- `flags` (sorted)
- `replica` type

**But it does NOT include `log_mode`.**

This means:
```elixir
# These two shapes are considered IDENTICAL by the cache:
shape1 = Shape.new!("offers", log_mode: :changes_only)
shape2 = Shape.new!("offers", log_mode: :full)

Shape.comparable(shape1) == Shape.comparable(shape2)  # TRUE - BUG!
```

### Cache Lookup Flow

1. `ShapeStatus.add_shape/2` inserts: `{Shape.comparable(shape), shape_handle}` into ETS
2. `ShapeStatus.get_existing_shape/2` looks up by: `Shape.comparable(shape)`
3. If found, returns existing handle

Source: `packages/sync-service/lib/electric/shape_cache/shape_status.ex:136,250`

## Reproduction Scenario

1. **Client A** requests `GET /v1/shape?table=offers&log=changes_only`
   - Shape created with `log_mode: :changes_only`
   - Handle "12345-1732123456789012" assigned
   - Initial snapshot is empty (by design - see `Querying.stream_initial_data/4:59-61`)
   - Cache stores: `{comparable(shape_with_changes_only), "12345-..."}`

2. **Client B** requests `GET /v1/shape?table=offers` (defaults to `log=full`)
   - ShapeCache calls `get_existing_shape()`
   - Lookup by `comparable()` finds Client A's shape (because `log_mode` not in key!)
   - Returns handle "12345-..." to Client B
   - Client B queries with this handle expecting full data
   - Gets `snapshot-end` message but **zero data rows**

3. **Result**: Client B thinks data is synced but has an empty dataset

## Critical Questions for Discussion

### 1. **Is this the correct fix location?**

Adding `log_mode` to `comparable()` seems correct since the docstring says:
> "This representation must contain all the information that identifies user-specified properties of the shape"

`log_mode` is user-specified via the `log` query parameter. But should we verify there aren't other user-specified properties missing?

### 2. **What about backward compatibility?**

Adding a field to `comparable()` changes the ETS lookup key, which means:

- **All existing shapes will get new handles after deployment**
- Clients with old handles will get 409 "must_refetch" responses
- This forces a global shape rotation for all clients

Is this acceptable? Should we:
- Accept it as equivalent to schema-based rotation?
- Implement a migration strategy?
- Add versioning to shape handles?

### 3. **Storage format implications**

The shape storage already includes `log_mode` in JSON serialization:
- `to_json_safe()` line 636
- `from_json_safe()` line 676

So restored shapes after restart will have the correct `log_mode`. The bug is only in the in-memory cache lookup. This means:

- Shapes restored from disk keep their original `log_mode`
- But cache lookups can't distinguish them
- Could this cause issues during the `:restore` flow vs `:create` flow?

### 4. **Are there other missing fields?**

Currently NOT in `comparable()`:
- `log_mode` ← **This is the bug**
- `storage` (intentionally excluded - internal config)
- `root_column_count` (intentionally excluded - metadata)
- `shape_dependencies` (intentionally excluded - internal state)
- `shape_dependencies_handles` (intentionally excluded - internal state)

Should we audit if any other user-specified options are missing?

### 5. **Changes-only mode implications**

The `changes_only` mode is designed to skip initial snapshots:
```elixir
def stream_initial_data(_, _, %Shape{log_mode: :changes_only}, _) do
  []  # No initial data
end
```

This is intentional for on-demand/subset workflows. But the bug means:
- A `:changes_only` shape can "poison" subsequent `:full` requests
- Users might not realize they're in changes-only mode
- No clear error message - just missing data

Should we:
- Add validation to reject mismatched log_mode with existing handle?
- Return explicit errors instead of empty data?
- Add telemetry/logging when this collision occurs?

### 6. **On-demand mode interaction**

From Marius's report, the issue appeared when using on-demand mode. On-demand typically uses:
- `log=changes_only` (no initial snapshot)
- `subset__*` parameters for filtering

Is there a scenario where:
1. On-demand creates a `:changes_only` shape
2. Client disconnects/reconnects
3. Client retries without subset parameters (expecting eager mode)
4. Gets stuck with the `:changes_only` shape?

This could explain the "even on a branch where on-demand was disabled" observation.

### 7. **Shape rotation timing**

When `comparable()` changes:
- What happens to in-flight requests?
- What happens to SSE connections?
- Should we drain old shapes before deployment?
- Do we need a deployment strategy doc for this change?

### 8. **Test coverage gaps**

Looking at existing tests (`test/electric/plug/router_test.exs`):
- Tests for `changes_only` mode exist (line 2654)
- Tests for subset snapshots exist (line 2672)
- But NO test for: "create changes_only, then create full mode on same table"

This suggests other similar scenarios might be untested. Should we:
- Audit test coverage for shape mode combinations?
- Add property-based tests for `comparable()` uniqueness?

## Impact Assessment

**Severity**: High - Data availability issues in production

**Affected scenarios**:
- ✅ On-demand mode + eager mode on same table (confirmed by Marius)
- ❓ Shape log mode changes during client reconnection
- ❓ Multiple clients with different log mode preferences
- ❓ Shape handle persistence across server restarts

**Workarounds**:
- Clear cache (not acceptable for production)
- Use different table names (not practical)
- Avoid mixing log modes (hard to enforce)

## Potential Solutions & Trade-offs

### Option 1: Add `log_mode` to `comparable()`
**Pros**: Fixes the bug, semantically correct
**Cons**: Breaking change, global shape rotation

### Option 2: Validate log_mode matches on handle reuse
**Pros**: No breaking change, explicit errors
**Cons**: Doesn't prevent the cache collision, confusing UX

### Option 3: Namespace shapes by log_mode in cache
**Pros**: Backward compatible, isolated fix
**Cons**: More complex, changes cache structure

### Option 4: Remove changes_only shapes from cache entirely
**Pros**: Changes-only is stateless, could be ephemeral
**Cons**: Different semantics, potential performance impact

## Questions for Backend Team

1. Is adding `log_mode` to `comparable()` the right approach?
2. What's our strategy for handling the breaking change?
3. Should we version the shape handle format?
4. Are there other fields we should audit for inclusion in `comparable()`?
5. Should we add validation/errors when log_mode mismatches?
6. Do we need a deployment runbook for this change?
7. Should changes_only shapes be treated differently by the cache?
8. How do we prevent similar issues in the future?

## Related Code Locations

- `lib/electric/shapes/shape.ex:98-103` - `comparable()` function
- `lib/electric/shape_cache/shape_status.ex:136` - Cache insertion
- `lib/electric/shape_cache/shape_status.ex:250` - Cache lookup
- `lib/electric/shapes/querying.ex:59-61` - Empty data for changes_only
- `test/electric/plug/router_test.exs:2654` - Existing changes_only tests

## Next Steps

Looking for feedback on:
1. Preferred solution approach
2. Migration/deployment strategy
3. Additional test cases needed
4. Documentation updates required

cc @backend-team
