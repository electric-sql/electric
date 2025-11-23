## Investigation Complete ✅

I've investigated this issue and identified the root cause along with a proposed fix.

### TL;DR

**Root Cause:** Missing comparison operator overloads for enum types (`anyenum`) in Electric's expression evaluation system.

**Impact:** Subset queries with WHERE clauses filtering on enum columns fail during validation, while eager mode works because it bypasses this strict validation.

**Proposed Fix:** Add 2 lines of code to define equality/inequality operators for the `anyenum` polymorphic type (following the same pattern as existing `anyarray` operators).

---

### Root Cause Details

When Electric parses a subset WHERE clause like `"challenge" = $1` (where `challenge` is an enum column):

1. The parser tries to find a matching operator overload for `=` with types `[{:enum, "challenge"}, :unknown]`
2. No operator overload exists for enum types
3. Error is raised: `"Could not select an operator overload"`

The infrastructure for `anyenum` polymorphic types already exists in Electric (lines 35, 337, 393 in `env.ex`), but comparison operators were never defined for this type.

**Key File:** `packages/sync-service/lib/electric/replication/eval/env/known_functions.ex`

Currently has operators for: numeric types, text, uuid, date, time, timestamp, bool, interval, arrays
**Missing:** enum types

---

### Proposed Solution

Add to `known_functions.ex` after line 58:

```elixir
## Enum comparison operators
defpostgres("anyenum = anyenum -> bool", delegate: &Kernel.==/2)
defpostgres("anyenum <> anyenum -> bool", delegate: &Kernel.!=/2)
```

This mirrors how array operators are defined (lines 148-149):
```elixir
defpostgres("anyarray = anyarray -> bool", delegate: &Kernel.==/2)
defpostgres("anyarray <> anyarray -> bool", delegate: &Kernel.!=/2)
```

**Why this works:**
- Enum values are represented as strings internally in Elixir
- `Kernel.==/2` correctly handles string equality comparison
- The existing polymorphic type resolution will match specific enum types to `anyenum`
- Mirrors PostgreSQL's behavior (which auto-generates these operators for each enum type)

---

### Full Investigation Report

I've created a comprehensive investigation report with:
- Detailed root cause analysis
- Code flow walkthrough with line numbers
- Multiple solution options
- Testing recommendations
- Edge cases to consider
- Implementation checklist

**View full report:** [`INVESTIGATION_3488.md`](https://github.com/electric-sql/electric/blob/claude/investigate-issues-01L4G6yucdmcN2Y6sgudhLsj/INVESTIGATION_3488.md)

---

### Files to Modify

| File | Action | Lines |
|------|--------|-------|
| `packages/sync-service/lib/electric/replication/eval/env/known_functions.ex` | Add 2 operator definitions | After line 58 |
| `packages/sync-service/test/electric/replication/eval/parser_test.exs` | Add test cases for enum comparisons | New test block |

---

### Questions for Implementation

1. **Ordering operators:** Should we also add `<`, `>`, `<=`, `>=` for enum ordering?
   - PostgreSQL supports this based on enum value definition order
   - Would require tracking enum value order in Electric

2. **Cross-enum-type comparisons:** Should comparing different enum types be rejected?
   - PostgreSQL rejects `enum1_type = enum2_type`
   - May need additional type checking in operator implementation

3. **Text-to-enum implicit casting:** Should `enum_col = 'text_value'` work without explicit cast?
   - Currently blocked due to lack of string→enum cast function
   - PostgreSQL allows this with implicit casting

---

### Next Steps

- [ ] Review proposed solution
- [ ] Decide on scope (equality only vs. full comparison operators)
- [ ] Implement operator definitions
- [ ] Add comprehensive test coverage
- [ ] Verify fix with original reproduction case
- [ ] Consider edge cases (cross-type comparisons, text-to-enum coercion)

Let me know if you'd like me to proceed with implementing the fix, or if you need any clarification on the investigation findings!
