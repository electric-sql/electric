# Investigation Report: Issue #3488
## "Could not select an operator overload" with Enum Columns in Subset Queries

### Problem Statement

When using subset queries with WHERE clauses that filter on enum columns, Electric fails with the error:
```
"At location 12: Could not select an operator overload"
```

This error occurs specifically with subset queries, while eager mode works correctly for the same filters.

### Reproduction

**Environment:**
- Client: `@tanstack/electric-db-collection` v0.2.5
- Electric: v1.2.6 (Docker)

**Schema:**
```sql
CREATE TYPE challenge AS ENUM ('value1', 'value2');
CREATE TYPE category AS ENUM ('cat1', 'cat2');

CREATE TABLE locks (
  challenge challenge,
  school integer REFERENCES schools(id),
  category category,
  PRIMARY KEY (challenge, school, category)
);
```

**Failing Code:**
```typescript
locks.subset({
  where: {
    challenge: challengeId  // challengeId is a string matching an enum value
  },
  select: { school: true, category: true }
})
```

**Generated WHERE clause:** `"challenge" = $1`

**Result:** Error at parsing/validation stage

**Working Code:**
```typescript
locks.sync()  // eager mode - no error
```

---

## Root Cause Analysis

### 1. Missing Operator Overloads for Enum Types

**File:** `packages/sync-service/lib/electric/replication/eval/env/known_functions.ex`

The `defcompare` macro (lines 47-53) generates comparison operators (`=`, `<>`, `<`, `>`, `<=`, `>=`) for specific types:

```elixir
defcompare("*numeric_type*", using: Kernel)   # int2, int4, int8, numeric, float4, float8
defcompare("text", using: Kernel)
defcompare("uuid", using: Kernel)
defcompare("date", using: &Date.compare/2)
defcompare("time", using: &Time.compare/2)
defcompare("timestamp", using: &NaiveDateTime.compare/2)
defcompare("timestamptz", using: &DateTime.compare/2)
```

**Missing:** No comparison operators for enum types or the `anyenum` polymorphic type.

### 2. How Enum Types are Represented

**File:** `packages/sync-service/lib/electric/postgres/inspector.ex` (lines 149-150)

When Electric introspects the database schema, enum columns are detected and represented as:
```elixir
{:enum, "enum_type_name"}
```

For example: `{:enum, "challenge"}`, `{:enum, "category"}`

### 3. Operator Resolution Failure Path

**File:** `packages/sync-service/lib/electric/replication/eval/parser.ex` (lines 1031-1043)

When parsing the WHERE clause `"challenge" = $1`:

1. `find_operator_func/4` is called with:
   - Operator name: `"="`
   - Arguments: `[%Ref{type: {:enum, "challenge"}}, %UnknownConst{}]`
   - Argument types: `[{:enum, "challenge"}, :unknown]`

2. `find_available_operators/4` successfully finds all `=` operators (line 1074)

3. `Lookups.pick_concrete_operator_overload/3` is called to select the right overload (line 1036)

4. **FAILURE:** No operator overload matches `[{:enum, "challenge"}, :unknown]`
   - Available overloads: `int4 = int4`, `text = text`, `uuid = uuid`, etc.
   - No overload for `anyenum = anyenum`

5. Error returned at line 1042:
   ```elixir
   :error -> {:error, {location, "Could not select an operator overload"}}
   ```

### 4. Why Subset Queries Fail But Eager Mode Works

**File:** `packages/sync-service/lib/electric/shapes/shape/subset.ex` (lines 70-82)

Subset queries perform strict WHERE clause validation:

```elixir
defp validate_where_clause(where, params, refs) do
  with {:ok, where} <- Parser.parse_query(where),
       {:ok, subqueries} <- Parser.extract_subqueries(where),
       :ok <- assert_no_subqueries(subqueries),
       :ok <- Validators.validate_parameters(params),
       {:ok, where} <- Parser.validate_where_ast(where, params: params, refs: refs),  # <- STRICT VALIDATION
       {:ok, where} <- Validators.validate_where_return_type(where) do
    {:ok, where}
  # ...
end
```

The `Parser.validate_where_ast/2` function strictly validates all operators, requiring them to resolve to concrete implementations.

**Eager mode** likely has a different code path that either:
- Doesn't validate the WHERE clause as strictly upfront
- Delegates filtering to PostgreSQL directly
- Has additional fallback logic for unknown types

### 5. Existing Polymorphic Type Infrastructure

**File:** `packages/sync-service/lib/electric/replication/eval/env.ex`

Electric already has infrastructure for PostgreSQL polymorphic types, including `anyenum`:

```elixir
# Line 35
@simple_polymorphic_types ~w|anyelement anyarray anynonarray anyenum anyrange anymultirange|a

# Line 337
defp replace_polymorphics(:anyenum, simple_consensus, _), do: {:enum, simple_consensus}

# Line 393-395
defp simple_polymorphics_consensus([{{:enum, _} = elem, :anyenum} | tail], x)
     when is_nil(x) or elem == x,
     do: simple_polymorphics_consensus(tail, elem)
```

This infrastructure is already used for array operators (lines 148-149 in `known_functions.ex`):
```elixir
defpostgres("anyarray = anyarray -> bool", delegate: &Kernel.==/2)
defpostgres("anyarray <> anyarray -> bool", delegate: &Kernel.!=/2)
```

**The same pattern should work for enum types.**

---

## Proposed Solution

### Option 1: Add Comparison Operators for `anyenum` (Recommended)

**File:** `packages/sync-service/lib/electric/replication/eval/env/known_functions.ex`

Add after line 58 (after the bool comparison operators):

```elixir
## Enum comparison operators
defpostgres("anyenum = anyenum -> bool", delegate: &Kernel.==/2)
defpostgres("anyenum <> anyenum -> bool", delegate: &Kernel.!=/2)
```

**Optional - for full PostgreSQL compatibility:**
```elixir
defpostgres("anyenum < anyenum -> bool", delegate: &Kernel.</2)
defpostgres("anyenum > anyenum -> bool", delegate: &Kernel.>/2)
defpostgres("anyenum <= anyenum -> bool", delegate: &Kernel.<=/2)
defpostgres("anyenum >= anyenum -> bool", delegate: &Kernel.>=/2)
```

**Why this works:**
1. Enum values are stored as strings internally in Elixir
2. `Kernel.==/2` correctly compares string values
3. Follows the existing pattern for `anyarray` operators
4. Leverages existing `anyenum` polymorphic type infrastructure
5. PostgreSQL automatically generates these operators for each enum type, so Electric should support them

**Type resolution example:**
- Input: `{:enum, "challenge"} = :unknown`
- Matches: `anyenum = anyenum`
- `anyenum` resolves to `{:enum, "challenge"}` using existing polymorphic resolution
- Result: Valid operator overload found

### Option 2: Use `defcompare` macro for `anyenum`

This might require extending the `defcompare` macro to handle polymorphic types, which is more complex.

---

## Key Files and Line Numbers

| File | Lines | Description |
|------|-------|-------------|
| `packages/sync-service/lib/electric/replication/eval/env/known_functions.ex` | 47-58 | Where comparison operators are defined (add enum operators here) |
| `packages/sync-service/lib/electric/replication/eval/parser.ex` | 1031-1043 | `find_operator_func/4` - where error is raised |
| `packages/sync-service/lib/electric/replication/eval/lookups.ex` | 76-96 | `pick_concrete_operator_overload/3` - operator selection logic |
| `packages/sync-service/lib/electric/shapes/shape/subset.ex` | 70-82 | Subset WHERE clause validation entry point |
| `packages/sync-service/lib/electric/replication/eval/env.ex` | 35, 337, 393 | Polymorphic `anyenum` type infrastructure |
| `packages/sync-service/lib/electric/postgres/inspector.ex` | 149-150 | Enum type detection and representation |

---

## Testing Recommendations

### Unit Tests

**File:** `packages/sync-service/test/electric/replication/eval/parser_test.exs`

Add test cases:

```elixir
describe "enum comparison operators" do
  test "should correctly parse enum equality comparison" do
    refs = %{["status"] => {:enum, "status_type"}}

    assert {:ok, %Expr{eval: result}} =
             Parser.parse_and_validate_expression(
               ~S|"status" = 'active'|,
               refs: refs
             )

    assert %Func{name: "=", args: [%Ref{type: {:enum, "status_type"}}, %Const{value: "active"}]} = result
  end

  test "should correctly parse enum inequality comparison" do
    refs = %{["status"] => {:enum, "status_type"}}

    assert {:ok, %Expr{}} =
             Parser.parse_and_validate_expression(
               ~S|"status" <> 'inactive'|,
               refs: refs
             )
  end

  test "should correctly parse enum comparison with parameters" do
    refs = %{["challenge"] => {:enum, "challenge_type"}}
    params = %{"1" => "value1"}

    assert {:ok, %Expr{}} =
             Parser.parse_and_validate_expression(
               ~S|"challenge" = $1|,
               refs: refs,
               params: params
             )
  end

  test "should correctly parse enum comparison between two enum columns" do
    refs = %{
      ["challenge1"] => {:enum, "challenge_type"},
      ["challenge2"] => {:enum, "challenge_type"}
    }

    assert {:ok, %Expr{}} =
             Parser.parse_and_validate_expression(
               ~S|"challenge1" = "challenge2"|,
               refs: refs
             )
  end
end
```

### Integration Tests

Test subset queries with enum filters end-to-end to ensure the fix resolves the original issue.

---

## Additional Context

### PostgreSQL Behavior

In PostgreSQL, when you create an enum type:
```sql
CREATE TYPE status AS ENUM ('active', 'inactive', 'pending');
```

PostgreSQL automatically generates comparison operators:
```sql
SELECT * FROM pg_operator WHERE oprleft = 'status'::regtype;
```

Returns operators: `=`, `<>`, `<`, `>`, `<=`, `>=`

Electric should mirror this behavior to maintain compatibility.

### Enum Internal Representation

- **PostgreSQL:** Enums are stored as integer OIDs internally with string labels
- **Electric (Elixir):** Enums are represented as strings (the label values)
- **Comparison:** String comparison with `Kernel.==/2` is semantically correct for equality checks

### Type Coercion Limitations

**File:** `packages/sync-service/lib/electric/replication/eval/env.ex` (lines 248-261)

Casting FROM a string TO an enum is explicitly blocked:
```elixir
defp find_cast_in_function(_env, {:enum, _to_type}) do
  # we can't convert arbitrary strings to enums until we know
  # the DDL for the enum
  :error
end
```

This means enum comparisons must work with the enum type directly, not rely on string-to-enum casting. The proposed solution handles this correctly by matching enum types in operator overloads.

---

## Questions for Implementation

1. **Ordering operators (`<`, `>`, etc.):** Should we implement all comparison operators or just equality/inequality?
   - PostgreSQL supports ordering for enums based on definition order
   - Would require tracking enum value order, which Electric may not currently do

2. **Cross-enum-type comparisons:** Should `enum1 = enum2` where types differ be allowed or rejected?
   - PostgreSQL rejects this
   - Current solution with `anyenum` might allow it
   - May need additional type checking in the operator implementation

3. **Enum-to-text comparisons:** Should `enum_col = 'text_value'` work?
   - Requires implicit casting from text to enum
   - Currently blocked (see type coercion limitations above)
   - May need to add text-to-enum cast function

---

## Implementation Checklist

- [ ] Add `anyenum = anyenum` operator to `known_functions.ex`
- [ ] Add `anyenum <> anyenum` operator to `known_functions.ex`
- [ ] Consider adding ordering operators (`<`, `>`, `<=`, `>=`)
- [ ] Add unit tests for enum comparison in `parser_test.exs`
- [ ] Add integration tests for subset queries with enum filters
- [ ] Test with parameterized queries (`$1`, `$2`, etc.)
- [ ] Test with multiple enum types in same query
- [ ] Verify eager mode continues to work
- [ ] Update documentation if needed

---

## Related PostgreSQL Documentation

- [Enum Types](https://www.postgresql.org/docs/current/datatype-enum.html)
- [Polymorphic Types](https://www.postgresql.org/docs/current/extend-type-system.html#EXTEND-TYPES-POLYMORPHIC)
- [Type Conversion](https://www.postgresql.org/docs/current/typeconv-oper.html)

---

## Conclusion

The fix is straightforward: add comparison operator definitions for the `anyenum` polymorphic type following the same pattern as `anyarray`. The existing infrastructure already supports `anyenum` type resolution. This should resolve the subset query issue while maintaining compatibility with PostgreSQL behavior.

The minimal fix requires only 2 lines of code:
```elixir
defpostgres("anyenum = anyenum -> bool", delegate: &Kernel.==/2)
defpostgres("anyenum <> anyenum -> bool", delegate: &Kernel.!=/2)
```

However, comprehensive testing and consideration of edge cases (ordering, cross-type comparisons, text-to-enum coercion) should be part of the implementation.
