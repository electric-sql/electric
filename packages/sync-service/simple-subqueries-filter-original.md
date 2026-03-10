## Shapes.Filter

For subqueries, the Shapes.Filter should support subqueries using a reverse index per subquery. We'd use an ETS table, but conceptually the reverse index can be thought of as a map of values to shape handles:

%{
    "1" => MapSet.new([handle1, handle2]),
    "2" => MapSet.new([handle2, handle3]),
    "3" => MapSet.new([handle1])
}

Then when a value comes in, we can look up the value in the reverse index and get the set of shape handles that match that value.

Shapes that have not been indexed (for example if their where clause also has `LIKE` in it) end up in `other_shapes` and are iterated through using `WhereClause.includes_record?/3`.I propose we use the reverse index in this situation too (for simplicity and to avoid holding more in memory). Whereas currently for `x IN subquery` `includes_record?/3` gets all the values in the materialized view of the subquery which we keep in `refs` to see if the the value of `x` from `record` is in that set, we can instead look up the value of `x` in the reverse index and see if our shape handle is in the list. This will mean changing how `WhereClause.includes_record?/3` works, perhaps giving a function to work out subquery inclusion instead of a function for refs, and perhaps the shape handle can be passed in the closure of that function.

The reverse-index will just provide a set of possible shape handles, the Filter will still need to filter this set for the shape handles relevant for the current WhereCondition since the WhereCondition may be on a branch where the shape could never reach.


## Managing the reverse index

### Consumer independence

Each consumer has subquery views at differnt times, so the consumer should manage the reverse index for it's subqueries.

The consumer can add and remove values from the index independently of other shapes:

```elixir
index = %{ "1" => MapSet.new(["handle1"]) }

ReverseIndex.add_value(index, "handle2", _value = "1")

# %{ "1" => MapSet.new([handle1, handle2]) }
```

### Move-ins

While a move-in query is in flight we need to buffer the changes. These changes need to include:
- Relavant changes for the shape BEFORE the move-in
- Relavant changes for the shape AFTER the move-in

For shapes without negation (e.g. `NOT IN subquery`) the reverse index should be the union of the before and after subquery views, so the consumer should add the moved-in value to the reverse index. For negation you need the intersection of the before and after subquery views, so you remove the move-in value. 

Consistency is maintained even if the consumer gets more changes than it needs since it will filter out ones it doesn't need with Shape.convert_change. The importnant thing is that is doesn't miss changes.

### Move-outs

In some scenarios we process move-outs the moment the the move-out message is received by the the consumer, so this could be mid-transaction and the Filter will have already filtered the changes for the rest of the transaction. This is not an issue because the shapes that do not have negation as the changes will already include enough for before and after the move-out, and for shapes with negation the move-out becomes a move-in and can follow move-in semantics.
