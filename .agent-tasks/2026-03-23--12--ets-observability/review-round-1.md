## Review Round 1

### What's Working Well

1. **Clean parallel with `process_memory`**: The `ets_table_memory/1` function in ApplicationTelemetry follows the exact same pattern as `process_memory/1` -- pattern-match on opts to extract the count, call a data-gathering function, iterate and emit telemetry events. This is well done.

2. **Integration in opts.ex is correct**: The `top_ets_table_count` key sits alongside `top_process_count` in `intervals_and_thresholds`, with a sensible default of 10. The type and placement are consistent.

3. **Type extraction logic is reasonable**: The colon-separator and underscore-separator UUID detection handles the real-world Electric table naming patterns (e.g. `Electric.StatusMonitor:6dd7c00b-8e31`, `shapedb:shape_lookup:61fec704-7dbf-49a5`, `stack_call_home_telemetry_6dd7c00b`). The regex is appropriately permissive for partial/truncated UUIDs.

4. **`top_memory_stats/2` avoids redundant work**: The combined function scans `:ets.all()` once and computes type stats once, which is the right approach.

5. **Memory calculation correctly uses word size**: Converting from words to bytes via `:erlang.system_info(:wordsize)` is correct.

### Critical Issues

1. **Atom table exhaustion risk via `String.to_atom/1`** (ets_tables.ex:244, 250)

   `table_type/1` calls `String.to_atom/1` on extracted type strings. While in practice the number of distinct *types* is bounded, this is called on every table on every poll interval. If an attacker or bug creates ETS tables with adversarial names that produce many unique type strings, this would leak atoms. Consider using `String.to_existing_atom/1` with a fallback, or keeping types as strings throughout (the telemetry metadata in `ets_table_memory/1` already calls `to_string(type)` anyway, so the atom round-trip is unnecessary).

2. **`table_name/1` returns `table_ref` (a reference) for unnamed tables, but `table_type/1` has no clause for references** (ets_tables.ex:215-219, 240-253)

   For unnamed (not `:named_table`) ETS tables, `:ets.info(table_ref, :name)` returns the *atom name* given to `:ets.new/2`, not `:undefined`. The `:undefined` return only happens when the table has been deleted between `:ets.all()` and the `:ets.info/2` call. So the `table_ref` fallback in `table_name/1` would be a reference, which then hits the catch-all `table_type(name), do: name` clause -- this means the reference becomes the type key in the map, which is not useful for grouping and would fail the `to_string(type)` call in `ets_table_memory/1`. This is a race-condition edge case but should be handled (e.g., return a sentinel atom like `:unknown`).

### Important Issues

1. **UUID regex is too greedy for underscore-separated names** (ets_tables.ex:257, 267-269)

   The UUID pattern `~r/^[0-9a-f]{8}(-[0-9a-f]{4}){0,3}(-[0-9a-f]{1,12})?/i` matches any 8+ hex characters. For underscore-separated names, this is problematic because many legitimate name segments are 8+ hex-like characters. For example, a table named `:my_deadbeef_tracker` would incorrectly strip `deadbeef_tracker` and type as `:my`. The colon-separator case is less risky since colons are rarer in names.

   Consider tightening the underscore case to require a full UUID (or at minimum 8-4 pattern) rather than just 8 hex chars. Or at least require that the hex segment is at a word boundary and looks UUID-like (has dashes).

2. **Test assertions use `if` guards that silently pass when tables are not found** (ets_tables_test.exs, multiple locations)

   Many tests wrap their core assertions in `if electric_test_type do ... end` or `if length(test_tables) > 0 do ... end`. This means if the test tables don't appear in results (e.g., due to a bug causing them to be filtered out), the test still passes with zero assertions. These should be `assert` calls or at minimum the test should fail if the expected table is not found. For example:

   ```elixir
   # Instead of:
   if group_test_type do
     assert group_test_type.table_count == 3
   end

   # Use:
   assert group_test_type != nil
   assert group_test_type.table_count == 3
   ```

3. **Test table cleanup is not guaranteed on failure** (ets_tables_test.exs)

   If an assertion fails mid-test, the cleanup calls at the end (`ets.delete`) are never reached. Since tests use `async: true`, leaked named tables could cause failures in other tests. Use `on_exit` callbacks or `setup`/`setup_all` blocks for cleanup. Alternatively, avoid `:named_table` where possible (several tests already do this).

4. **`top_tables/1` return doc says `:type_table_count` and `:avg_size_per_type` but `top_by_type/1` returns `:table_count` and `:avg_size`** (ets_tables.ex:26, 78)

   The inconsistent naming between `type_table_count` / `table_count` and `avg_size_per_type` / `avg_size` across the two return types is confusing. Consider unifying: either both use `table_count` / `avg_size`, or document clearly why they differ.

### Suggestions

1. **Consider whether `top_memory_stats/2` is needed in the public API**: It is not called anywhere in the integration. Only `top_by_type/1` is used by `ets_table_memory/1`. The `top_tables/1` and `top_memory_stats/2` functions add API surface area that isn't exercised in production. If they're intended for manual debugging/IEx use, that's fine, but worth documenting that intent.

2. **The `top_by_type/1` function is called every poll interval (default 5s)**: This iterates all ETS tables, does regex matching, grouping, and sorting. On a system with thousands of ETS tables, this could be non-trivial. Consider whether this should have its own, slower poll interval, or if the cost is acceptable. The `process_memory` function has the same profile so this may already be a known trade-off.

3. **Minor: `calculate_type_stats` uses two `Enum.reduce` calls** (ets_tables.ex:200-201): These could be combined into a single pass:
   ```elixir
   {total_memory, total_size} = Enum.reduce(tables, {0, 0}, fn table, {mem, sz} ->
     {mem + table.memory, sz + table.size}
   end)
   ```

4. **The `count > 0` check in `calculate_type_stats`** (ets_tables.ex:203) is always true since you only get into that branch from `Enum.group_by` results, which always have at least one element per group. The guard is harmless but unnecessary.

5. **Metric name convention**: `process.memory.total` uses dots while `ets_table.memory.total` uses an underscore in the first segment. Consider `ets-table.memory.total` or `ets_table.memory.total` -- the underscore is fine but worth verifying it matches whatever naming convention the downstream observability tooling expects.

6. **Test for `top_tables` asserts `length(results) >= 3`** (ets_tables_test.exs:22): This should be `length(results) == 3` since the test creates 3 tables with data and asks for top 3. The `>=` assertion would pass even if it returned 100 results, which would indicate a bug in the `take` logic.
