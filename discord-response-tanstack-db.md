# Answers to Caio's Questions

## Question 1: Complex JOIN Query for Check-ins with Active Events

> Is it possible to construct a query that returns all check_ins where reference_date falls within the date range of an active event at the same venue?

### Short Answer

Electric shapes are **single-table only**, so your JOIN-based SQL query won't work directly. However, **TanStack DB** is the recommended solution for exactly this use case.

### Solution: Use TanStack DB

TanStack DB is a reactive client store that integrates with Electric and supports full JOIN capabilities on the client side. Here's how to solve your exact query:

#### 1. Set Up Collections

```typescript
import { createCollection, electricCollectionOptions } from '@tanstack/electric-db-collection'

export const venueCollection = createCollection(
  electricCollectionOptions({
    id: 'venues',
    shapeOptions: { url: '/api/shapes/venues' },
    schema: venueSchema,
    getKey: (item) => item.id,
  })
)

export const eventCollection = createCollection(
  electricCollectionOptions({
    id: 'events',
    shapeOptions: { url: '/api/shapes/events' },
    schema: eventSchema,
    getKey: (item) => item.id,
  })
)

export const checkInCollection = createCollection(
  electricCollectionOptions({
    id: 'check_ins',
    shapeOptions: { url: '/api/shapes/check_ins' },
    schema: checkInSchema,
    getKey: (item) => item.id,
  })
)
```

#### 2. Query with JOINs

```typescript
import { useLiveQuery } from '@tanstack/react-db'
import { eq } from '@tanstack/db'

const venueIds = [1, 2, 3] // your set of venue IDs

const { data: checkIns } = useLiveQuery(
  (query) =>
    query
      .from({ c: checkInCollection })
      .innerJoin({ v: venueCollection }, ({ c, v }) =>
        eq(v.id, c.venue_id)
      )
      .innerJoin({ e: eventCollection }, ({ v, e }) =>
        eq(e.venue_id, v.id)
      )
      .where(({ v }) => venueIds.includes(v.id))
      .where(({ e }) => eq(e.is_active, true))
      // Use .fn.where() for complex date comparisons
      .fn.where(({ c, e }) =>
        e.start_date <= c.reference_date &&
        e.end_date >= c.reference_date
      )
      .select(({ c }) => ({
        id: c.id,
        venue_id: c.venue_id,
        reference_date: c.reference_date,
        // ... other check_in fields
      })),
  [venueIds]
)
```

#### Why TanStack DB?

| Feature | Electric Shapes Alone | TanStack DB |
|---------|----------------------|-------------|
| JOINs across tables | ❌ No | ✅ Yes |
| Date range comparisons | ❌ Limited | ✅ Full support via `.fn.where()` |
| Reactive updates | ✅ Yes | ✅ Yes (sub-millisecond) |
| Complex filtering | ❌ SQL-only | ✅ Custom JS logic |
| Aggregations (GROUP BY, COUNT) | ❌ No | ✅ Yes |

The `.fn.where()` method allows arbitrary JavaScript logic, making the date range comparison straightforward.

#### Resources

- [TanStack DB Integration Docs](https://electric-sql.com/docs/integrations/tanstack)
- [TanStack DB Web Starter Example](https://github.com/electric-sql/electric/tree/main/examples/tanstack-db-web-starter)
- [Complex JOIN Examples (Burn app)](https://github.com/electric-sql/electric/tree/main/examples/burn/assets/src/components/ChatArea.tsx)

---

## Question 2: `sync_render/4` Not Accepting Functions

> Does it make sense to accept `fn -> shape()` in the 4-arity version of `sync_render`?

### Answer

This is currently **by design**, but your suggestion is reasonable.

- **3-arity** `sync_render(conn, params, shape_fun)` — accepts a zero-arity function for interruptible long-poll requests
- **4-arity** `sync_render(conn, params, shape, shape_opts)` — takes a static shape plus options

The function parameter in 3-arity enables dynamic re-evaluation when shapes change (via `Phoenix.Sync.interrupt/2`). The 4-arity was designed for simpler static shape + options use cases.

### Suggestion

A PR to add function support to 4-arity (or a new 5-arity version) would be a welcome contribution. The implementation could detect `is_function(shape, 0)` and handle both cases.

---

## Question 3: Ecto `subquery()` vs Raw SQL Subqueries

> Why can we do `SELECT ... WHERE x IN (subquery)` but not the same with Ecto's `subquery()`?

### Answer

The Elixir client's EctoAdapter has **commented-out code** for handling `%Ecto.SubQuery{}`. The implementation was started but never completed.

**In `packages/elixir-client/lib/electric/client/ecto_adapter/postgres.ex:125-127`:**

```elixir
# defp expr({:in, _, [left, %Ecto.SubQuery{} = subquery]}, sources, query) do
#   [expr(left, sources, query), " IN ", expr(subquery, sources, query)]
# end
```

When you use `Ecto.subquery()`, it falls through to an error handler that raises "unsupported expression."

**Raw SQL works** because it bypasses the Ecto adapter entirely and goes directly to Electric's SQL parser (which supports subqueries via the `allow_subqueries` feature flag).

### Workaround

```elixir
# Instead of (won't work):
from(c in Child, where: c.parent_id in subquery(from(p in Parent, select: p.id)))

# Use raw SQL (works):
ShapeDefinition.new!("child", where: "parent_id IN (SELECT id FROM parent WHERE active = true)")
```

### Contributing

Adding Ecto subquery support would be a good contribution. The commented-out code shows the intended approach — it needs to be completed and tested.

---

## Summary

For your complex query needs with JOINs and date range filtering, **TanStack DB is the recommended approach**. It provides:

- Full JOIN support across multiple collections
- Sub-millisecond reactive query performance (powered by differential dataflow)
- Custom JavaScript filtering logic via `.fn.where()`
- Type-safe queries with TypeScript
- Seamless integration with Electric's sync engine
