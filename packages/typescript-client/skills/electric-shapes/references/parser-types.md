---
name: parser-types-reference
parent: electric-shapes
---

# Parser Type Mapping Reference

Electric sends all Postgres values as strings over HTTP. Use the `parser` option
on `ShapeStream` to convert them to JavaScript types.

## Common Type Parsers

| Postgres Type | Parser                        | JavaScript Type |
| ------------- | ----------------------------- | --------------- |
| `timestamptz` | `(v) => new Date(v)`          | `Date`          |
| `timestamp`   | `(v) => new Date(v)`          | `Date`          |
| `jsonb`       | `(v) => JSON.parse(v)`        | `object`        |
| `json`        | `(v) => JSON.parse(v)`        | `object`        |
| `numeric`     | `(v) => parseFloat(v)`        | `number`        |
| `float4`      | `(v) => parseFloat(v)`        | `number`        |
| `float8`      | `(v) => parseFloat(v)`        | `number`        |
| `int8`        | `(v) => BigInt(v)`            | `bigint`        |
| `bool`        | `(v) => v === "true"`         | `boolean`       |
| `bytea`       | `(v) => Uint8Array.from(...)` | `Uint8Array`    |

## Array Types

Postgres array types are prefixed with `_`:

| Postgres Type | Parser                                                         | JavaScript Type |
| ------------- | -------------------------------------------------------------- | --------------- |
| `_int4`       | `(v) => v.replace(/[{}]/g, "").split(",").map(Number)`         | `number[]`      |
| `_text`       | `(v) => v.replace(/[{}]/g, "").split(",")`                     | `string[]`      |
| `_bool`       | `(v) => v.replace(/[{}]/g, "").split(",").map(b => b === "t")` | `boolean[]`     |
| `_float8`     | `(v) => v.replace(/[{}]/g, "").split(",").map(parseFloat)`     | `number[]`      |

## NULL Handling

- NULL values are not passed through the parser
- The parser only receives non-null string values
- Your TypeScript types should account for nullability separately

## Custom Type Example

```typescript
const stream = new ShapeStream({
  url: `/api/locations`,
  parser: {
    point: (value: string) => {
      const [x, y] = value.replace(/[()]/g, '').split(',')
      return { x: parseFloat(x), y: parseFloat(y) }
    },
    daterange: (value: string) => {
      const [start, end] = value.replace(/[\[\]()]/g, '').split(',')
      return { start: new Date(start), end: new Date(end) }
    },
  },
})
```

## With TanStack DB Collections

When using `electricCollectionOptions`, pass the parser in `shapeOptions`:

```typescript
const collection = createCollection(
  electricCollectionOptions({
    id: 'events',
    schema: eventSchema,
    getKey: (row) => row.id,
    shapeOptions: {
      url: `/api/events`,
      parser: {
        timestamptz: (v: string) => new Date(v),
        jsonb: (v: string) => JSON.parse(v),
      },
    },
  })
)
```
