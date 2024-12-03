---
"@electric-sql/client": minor
"@electric-sql/react": minor
---

[BREAKING]: Move non-protocol options like table & where to the params sub-key

## Context

Electric's TypeScript client is currently tightly coupled to PostgreSQL-specific options in its `ShapeStreamOptions` interface. As Electric plans to support multiple data sources in the future, we need to separate protocol-level options from source-specific options.

## Changes

1. Created a new `PostgresParams` type to define PostgreSQL-specific parameters:
   - `table`: The root table for the shape
   - `where`: Where clauses for the shape
   - `columns`: Columns to include in the shape
   - `replica`: Whether to send full or partial row updates

2. Moved PostgreSQL-specific options from the top-level `ShapeStreamOptions` interface to the `params` sub-key
3. Updated `ParamsRecord` type to include PostgreSQL parameters
4. Updated the `ShapeStream` class to handle parameters from the `params` object
5. Updated documentation to reflect the changes

## Migration Example

Before:
```typescript
const stream = new ShapeStream({
  url: 'http://localhost:3000/v1/shape',
  table: 'users',
  where: 'id > 100',
  columns: ['id', 'name'],
  replica: 'full'
})
```

After:
```typescript
const stream = new ShapeStream({
  url: 'http://localhost:3000/v1/shape',
  params: {
    table: 'users',
    where: 'id > 100',
    columns: ['id', 'name'],
    replica: 'full'
  }
})
```
