## Shapes.Filter — Subquery Support via Reverse Index

For subqueries, the Shapes.Filter should support subqueries using a reverse
index per subquery. We'd use an ETS table, but conceptually the reverse index
can be thought of as a map of values to shape handles:

```elixir
%{
    "1" => MapSet.new([handle1, handle2]),
    "2" => MapSet.new([handle2, handle3]),
    "3" => MapSet.new([handle1])
}
```

When a change arrives with a value for the subquery column, we look up that
value in the reverse index and get the set of shape handles whose subquery
view contains that value.

### Integration with `WhereClause.includes_record?/3`

Shapes that cannot be indexed (for example because their `WHERE` clause also
has `LIKE` in it) currently end up in `other_shapes` and are iterated through
using `WhereClause.includes_record?/3`. We should use the reverse index for
subquery evaluation in this path too, for simplicity and to avoid holding more
in memory.

Currently, for `x IN subquery`, `includes_record?/3` gets all the values from
the materialized view of the subquery (kept in `refs`) and checks whether the
value of `x` from `record` is in that set. Instead, we look up the value of
`x` in the reverse index and check whether our shape handle is in the result
set.

This means changing the interface of `includes_record?/3`: instead of
passing a `refs` map containing the full subquery value set, we pass a
function that determines subquery inclusion. The shape handle can be captured
in the closure of that function.

### Candidate filtering

The reverse index provides a set of _candidate_ shape handles. The Filter
must still verify each candidate against the full `WhereCondition` for that
table, because the `WhereCondition` tree may include non-subquery branches
that rule the shape out.

## Managing the Reverse Index

### Consumer independence

Each consumer has subquery views at different times, so each consumer manages
the reverse index entries for its own shapes independently of other shapes:

```elixir
index = %{"1" => MapSet.new(["handle1"])}

ReverseIndex.add_value(index, "handle2", _value = "1")

# => %{"1" => MapSet.new(["handle1", "handle2"])}
```

Because the index is an ETS table, updates by one consumer are immediately
visible to the Filter running in the EventRouter process.

### Move-ins

While a move-in query is in flight we buffer changes (see
`simple-subqueries.md`, section B). During buffering the reverse index must be
broad enough to capture changes relevant to _both_ the pre-splice and
post-splice views:

- **Pre-splice changes** are converted with the old subquery view.
- **Post-splice changes** are converted with the new subquery view.

The safe strategy depends on whether the shape uses negation:

- **Shapes without negation** (i.e. shapes that do not use `NOT IN subquery`):
  The reverse index should be the _union_ of the before and after subquery
  views, so the consumer adds the moved-in value to the reverse index at the
  start of the move-in.

- **Shapes with negation** (i.e. shapes that use `NOT IN subquery`):
  The reverse index should be the _intersection_ of the before and after
  subquery views, so the consumer removes the moved-in value from the reverse
  index at the start of the move-in.

Consistency is maintained even if the Filter passes through more changes than
strictly necessary: `Shape.convert_change/3` will filter out any that do not
belong, using the correct subquery view for the change's position relative to
the splice boundary. The important invariant is that we never _miss_ a
relevant change.

### Move-outs

In some scenarios the consumer processes move-outs the moment the move-out
message is received, which can be mid-transaction. By that point the Filter
has already filtered changes for the remainder of the transaction using the
old reverse index state. This is safe:

- **Shapes without negation**: the old index already included the moved-out
  value, so changes for both before and after the move-out are captured. Any
  extra changes are filtered out by `Shape.convert_change/3`.

- **Shapes with negation**: a move-out from the subquery view means rows that
  _were_ excluded now become included — effectively a move-in from the shape's
  perspective. This case follows move-in semantics (buffering, splice
  boundary, etc.).
