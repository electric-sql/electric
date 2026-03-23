# Implementation Plan

## Root Cause

In `querying.ex`, `pg_cast_column_to_text/1` casts all columns to `::text` (line 277). In PostgreSQL, casting `bpchar` (char(n)) to `text` strips trailing spaces. This causes:
- Snapshot/subset queries to return trimmed char(n) values
- Replication (which sends raw WAL data) to return space-padded values
- Inconsistency between the two paths

## Fix Strategy: Runtime Type Detection in SQL

Instead of modifying the Shape struct to carry type info, use a PostgreSQL CASE expression with `pg_typeof()` to detect bpchar columns at runtime:

```sql
-- Instead of: "col"::text
-- Use:
CASE WHEN "col" IS NULL THEN NULL::text
     WHEN pg_typeof("col") = 'character'::regtype THEN concat("col", '')
     ELSE "col"::text END
```

Key insights verified experimentally:
- `concat(bpchar_col, '')` returns text WITH padding preserved
- `to_json(concat(bpchar_col, ''))::text` produces `"a       "` (JSON string with padding)
- `concat(bool_col, '')` returns `"t"` — but since this only triggers for bpchar, booleans still use `::text` → `"true"`
- NULL handling: must check IS NULL first since `concat(NULL, '')` returns `''` not NULL

## Changes Required

### Step 1: Modify `querying.ex` — change `pg_cast_column_to_text/1`

Replace:
```elixir
defp pg_cast_column_to_text(column), do: ~s["#{Utils.escape_quotes(column)}"::text]
```

With a function that produces the CASE expression preserving bpchar padding.

This single change fixes:
- `escape_column_value` (used for value JSON — line 272)
- `join_primary_keys` (used for key building — line 240)
- `make_tags` (used for tag hashing — lines 157, 165)

### Step 2: Write reproducing test in `querying_test.exs`

Add a test that:
1. Creates a table with `char(n)` PK and columns
2. Inserts data
3. Verifies `stream_initial_data` returns space-padded values in both keys and values
4. Also test `query_move_in` and `query_subset` if applicable

### Step 3: Run tests

Verify the new test passes and no existing tests break.

## Discarded Approaches

1. **Modify Shape struct to carry bpchar column set**: Would require changes to Shape struct, serialization (to_json_safe/from_json_safe), and threading through all querying functions. More invasive.
2. **Universal `concat(col, '')` replacement**: Breaks booleans (`"t"` instead of `"true"`)
3. **`format('%s', col)` replacement**: Same boolean problem
4. **`::varchar` cast instead of `::text`**: PostgreSQL trims bpchar padding for both
