# Electric Shapes — WHERE Clause Reference

## Supported Column Types

| Type                       | Example                               | Notes                 |
| -------------------------- | ------------------------------------- | --------------------- |
| `text`, `varchar`, `char`  | `name = 'Alice'`                      | String comparison     |
| `int2`, `int4`, `int8`     | `age > 21`                            | Numeric comparison    |
| `float4`, `float8`         | `price < 9.99`                        | Float comparison      |
| `bool`                     | `active = true`                       | Boolean               |
| `uuid`                     | `id = '550e8400-...'`                 | UUID comparison       |
| `date`                     | `created > '2024-01-01'`              | Date comparison       |
| `timestamp`, `timestamptz` | `updated_at > '2024-01-01T00:00:00Z'` | Timestamp comparison  |
| `interval`                 | `duration > '1 hour'`                 | Interval comparison   |
| `numeric`                  | `amount >= 100.50`                    | Arbitrary precision   |
| `arrays`                   | `tags && ARRAY['urgent']`             | Array operations      |
| `enum`                     | `status::text IN ('active', 'done')`  | **Must cast to text** |

## Unsupported

- `timetz` — not supported in WHERE
- Non-deterministic functions: `now()`, `random()`, `count()`, `current_timestamp`
- Aggregate functions
- Subqueries (experimental, requires `ELECTRIC_FEATURE_FLAGS=allow_subqueries`)

## Positional Parameters

```ts
// Array format
params: { where: 'org_id = $1 AND role = $2', params: ['org-123', 'admin'] }

// Object format
params: { where: 'org_id = $1 AND role = $2', params: { '1': 'org-123', '2': 'admin' } }
```

## Operators

| Operator                 | Example                           |
| ------------------------ | --------------------------------- |
| `=`, `!=`, `<>`          | `status = 'active'`               |
| `<`, `>`, `<=`, `>=`     | `age >= 18`                       |
| `IN`                     | `status IN ('active', 'pending')` |
| `NOT IN`                 | `status NOT IN ('deleted')`       |
| `LIKE`, `ILIKE`          | `name ILIKE '%john%'`             |
| `IS NULL`, `IS NOT NULL` | `deleted_at IS NULL`              |
| `AND`, `OR`, `NOT`       | `active = true AND age > 18`      |
| `BETWEEN`                | `age BETWEEN 18 AND 65`           |
| `ANY`, `ALL`             | Array comparisons                 |

## Enum Gotcha

Enum columns require explicit `::text` cast:

```ts
// Wrong — fails silently or errors
params: {
  where: "status IN ('active', 'done')"
}

// Correct
params: {
  where: "status::text IN ('active', 'done')"
}
```
