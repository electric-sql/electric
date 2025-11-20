# Bug Report: Shape Cache Collision Between Different log_mode Values

## Summary

Shapes with different `log_mode` values (`:full` vs `:changes_only`) but otherwise identical parameters are treated as the same shape by the shape cache, causing data availability issues.

## Reported Symptoms

From Slack discussion by Marius:
- A shape doesn't return any data (returns "up-to-date" status but it's not actually up-to-date)
- Clearing the cache through the cloud console fixes the issue
- Suspected to be related to on-demand mode (which uses `log=changes_only`)
- Even on a branch where on-demand mode was disabled, the shape requests still showed behavior from changes_only mode

## Root Cause

The bug is in `/packages/sync-service/lib/electric/shapes/shape.ex` at lines 98-103:

```elixir
def comparable(%__MODULE__{} = shape) do
  {:shape, {shape.root_table_id, shape.root_table}, shape.root_pk,
   Comparable.comparable(shape.where), shape.selected_columns,
   Enum.flat_map(shape.flags, fn {k, v} -> if(v, do: [k], else: []) end) |> Enum.sort(),
   shape.replica}
end
```

**The `log_mode` field is NOT included in the `comparable()` function.**

This function is used by the shape cache to look up existing shapes in `/packages/sync-service/lib/electric/shape_cache/shape_status.ex`:

```elixir
# Line 136: Adding shape to cache
:ets.insert_new(shape_hash_lookup_table(stack_ref), {Shape.comparable(shape), shape_handle})

# Line 250: Looking up existing shape
:ets.lookup_element(
  shape_hash_lookup_table(stack_ref),
  Shape.comparable(shape),
  @shape_hash_lookup_handle_pos,
  nil
)
```

## How This Causes the Bug

### Scenario

1. **Client A** creates a shape with `log=changes_only` on table "offers":
   - Shape gets created with `log_mode: :changes_only`
   - Shape handle "ABC-123" is stored in ETS with `comparable(shape)` as key
   - Initial snapshot is empty by design (see `/packages/sync-service/lib/electric/shapes/querying.ex:59-61`):
     ```elixir
     def stream_initial_data(_, _, %Shape{log_mode: :changes_only}, _) do
       []  # No initial data for changes_only mode
     end
     ```

2. **Client B** (or same client on different branch) creates a shape on same table "offers" without specifying log mode (defaults to `:full`):
   - ShapeCache calls `get_existing_shape(stack_ref, shape)`
   - Since `comparable()` doesn't include `log_mode`, it finds the existing `:changes_only` shape from step 1
   - Returns handle "ABC-123" to Client B
   - Client B requests data using this handle, but gets nothing because the underlying shape is in `:changes_only` mode!

3. **Result**: Client B sees "up-to-date" status (snapshot-end message) but no data rows, because they're using a `:changes_only` shape when they expected a `:full` shape.

## Impact

- Users cannot reliably switch between `log=full` and `log=changes_only` on the same shape definition
- The first client to request a shape "wins" and determines the log_mode for all subsequent clients
- Clearing the cache is the only workaround, which is not acceptable for production
- This is particularly problematic when:
  - Using on-demand/subset mode (which typically uses `changes_only`)
  - Then trying to use normal eager mode on the same table
  - Or vice versa

## The Fix

Add `log_mode` to the `comparable()` function in `/packages/sync-service/lib/electric/shapes/shape.ex`:

```elixir
def comparable(%__MODULE__{} = shape) do
  {:shape, {shape.root_table_id, shape.root_table}, shape.root_pk,
   Comparable.comparable(shape.where), shape.selected_columns,
   Enum.flat_map(shape.flags, fn {k, v} -> if(v, do: [k], else: []) end) |> Enum.sort(),
   shape.replica, shape.log_mode}  # <- Add log_mode here
end
```

This ensures that shapes with different `log_mode` values are treated as distinct shapes by the cache.

## Test Case

The following test should be added to verify the fix:

```elixir
@tag with_sql: [
  "INSERT INTO items VALUES (gen_random_uuid(), 'test value 1')"
]
test "shapes with different log_mode values are treated as separate shapes", ctx do
  # First request: Create shape with changes_only mode
  req1 = make_shape_req("items", log: "changes_only")

  assert {req1, 200, [%{"headers" => %{"control" => "snapshot-end"}}]} =
    shape_req(req1, ctx.opts)

  handle1 = req1.assigns.shape_handle

  # Second request: Create shape with full mode (default)
  req2 = make_shape_req("items")  # log defaults to "full"

  assert {req2, 200, data} = shape_req(req2, ctx.opts)

  handle2 = req2.assigns.shape_handle

  # Verify different handles were created
  assert handle1 != handle2,
    "Shapes with different log_mode should have different handles"

  # Verify the full mode shape returns initial data
  assert length(data) > 1, "Full mode shape should return initial data"
  assert Enum.any?(data, fn item ->
    is_map(item) and Map.has_key?(item, "value")
  end), "Full mode shape should include data rows"

  # Verify changes_only mode shape has no data
  req3 = Map.put(req1, :assigns, %{shape_handle: handle1})
  assert {req3, 200, [%{"headers" => %{"control" => "snapshot-end"}}]} =
    shape_req(req3, ctx.opts)
end
```

## Related Code Locations

### Key Files
- `/packages/sync-service/lib/electric/shapes/shape.ex:98-103` - The `comparable()` function (bug location)
- `/packages/sync-service/lib/electric/shape_cache/shape_status.ex:136` - Shape insertion using comparable()
- `/packages/sync-service/lib/electric/shape_cache/shape_status.ex:250` - Shape lookup using comparable()
- `/packages/sync-service/lib/electric/shapes/querying.ex:59-61` - Empty data for changes_only mode

### Fields Currently in comparable()
- `root_table_id` - Table OID
- `root_table` - Schema and table name tuple
- `root_pk` - Primary key columns
- `where` - WHERE clause (via Comparable.comparable())
- `selected_columns` - Column selection
- `flags` - Shape flags (sorted list)
- `replica` - Replica type

### Fields NOT in comparable() (before fix)
- `log_mode` - `:full` or `:changes_only` **← This is the bug**
- `storage` - Storage configuration (intentionally excluded)
- `root_column_count` - Internal metadata (intentionally excluded)
- `shape_dependencies` - Internal state (intentionally excluded)

## Notes on the Fix

### Why log_mode Should Be Included

The `comparable()` function's docstring (lines 88-96) states:

> This representation must contain all the information that identifies **user-specified properties** of the shape.

`log_mode` is a user-specified property (via the `log` query parameter), so it should be included in `comparable()`.

### Backward Compatibility Concerns

**Breaking Change**: This fix will cause existing shapes to be treated as new shapes after deployment because their `comparable()` representation changes.

**Migration Impact**:
- Existing shape handles will no longer match after the fix is deployed
- Clients may receive 409 "must_refetch" responses and get new handles
- This is acceptable because it's the same behavior as when shapes rotate due to schema changes
- The alternative (not fixing) leaves the bug in place, which is worse

### Storage Considerations

The fix only affects the in-memory ETS cache lookup. The actual shape storage format (JSON serialization) already includes `log_mode` (see `to_json_safe()` and `from_json_safe()` at lines 622-677), so no storage migration is needed.

## Recommendation

**Priority**: HIGH - This causes data availability issues in production environments

**Action Items**:
1. Apply the fix to `Shape.comparable/1`
2. Add the test case to verify the fix
3. Document the breaking change in release notes
4. Consider if any additional fields should be reviewed for inclusion in `comparable()`
