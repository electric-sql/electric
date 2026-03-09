# Electric Shapes — Type Parser Reference

## Built-in Parsers

These parsers are applied automatically. All other types arrive as strings.

| Postgres Type | Parser        | Output Type | Notes                      |
| ------------- | ------------- | ----------- | -------------------------- |
| `int2`        | `parseNumber` | `number`    |                            |
| `int4`        | `parseNumber` | `number`    |                            |
| `int8`        | `parseBigInt` | `BigInt`    | Returns BigInt, not number |
| `float4`      | `parseNumber` | `number`    |                            |
| `float8`      | `parseNumber` | `number`    |                            |
| `bool`        | `parseBool`   | `boolean`   |                            |
| `json`        | `parseJson`   | `object`    |                            |
| `jsonb`       | `parseJson`   | `object`    |                            |

## Common Custom Parsers

```ts
const stream = new ShapeStream({
  url: '/api/items',
  parser: {
    timestamptz: (date: string) => new Date(date),
    timestamp: (date: string) => new Date(date),
    date: (date: string) => new Date(date),
    numeric: (n: string) => parseFloat(n),
    interval: (i: string) => i, // Keep as string or use a library
  },
})
```

## Parser Signature

```ts
type ParseFunction<Extensions = never> = (
  value: string,
  additionalInfo?: Omit<ColumnInfo, 'type' | 'dims'>
) => Value<Extensions>
```

The `additionalInfo` parameter provides column metadata like `precision`, `scale`, `max_length`, `not_null`.

## NULL Handling

If a column has `not_null: true` in the schema and a `NULL` value is received, the parser throws `ParserNullValueError`. This indicates a schema mismatch.

## Transformer vs Parser

- **Parser**: converts individual column values by Postgres type name
- **Transformer**: transforms the entire row object after parsing

```ts
const stream = new ShapeStream({
  url: '/api/items',
  parser: {
    timestamptz: (date: string) => new Date(date),
  },
  transformer: (row) => ({
    ...row,
    fullName: `${row.firstName} ${row.lastName}`,
  }),
})
```
