---
outline: deep
---

# TypeScript client

The TypeScript client is a higher-level client interface that wraps the [HTTP API](/docs/api/http) to make it easy to sync [Shapes](/docs/guides/shapes) in the web browser and other JavaScript environments.

Defined in [packages/typescript-client](https://github.com/electric-sql/electric/tree/main/packages/typescript-client), it provides a [ShapeStream](#shapestream) primitive to subscribe to a change stream and a [Shape](#shape) primitive to get the whole shape whenever it changes.

## Install

The client is published on NPM as [`@electric-sql/client`](https://www.npmjs.com/package/@electric-sql/client):

```sh
npm i @electric-sql/client
```

## How to use

The client exports a `ShapeStream` class for getting updates to shapes on a row-by-row basis as well as a `Shape` class for getting updates to the entire shape.

### `ShapeStream`

```tsx
import { ShapeStream } from '@electric-sql/client'

// Passes subscribers rows as they're inserted, updated, or deleted
const stream = new ShapeStream({
  url: `http://localhost:3000/v1/shape`,
  table: `foo`,
})

stream.subscribe(messages => {
  // messages is an array with one or more row updates
  // and the stream will wait for all subscribers to process them
  // before proceeding
})
```

#### Custom parsing

By default, `ShapeStream` parses the following Postgres types into native JavaScript values:

- `int2`, `int4`, `float4`, and `float8` are parsed into JavaScript `Number`
- `int8` is parsed into a JavaScript `BigInt`
- `bool` is parsed into a JavaScript `Boolean`
- `json` and `jsonb` are parsed into JavaScript values/arrays/objects using `JSON.parse`
- Postgres Arrays are parsed into JavaScript arrays, e.g. <code v-pre>"{{1,2},{3,4}}"</code> is parsed into `[[1,2],[3,4]]`

All other types aren't parsed and are left in the string format as they were served by the HTTP endpoint.

The `ShapeStream` can be configured with a custom parser that is an object mapping Postgres types to parsing functions for those types.
For example, we can extend the [default parser](https://github.com/electric-sql/electric/blob/main/packages/typescript-client/src/parser.ts#L14-L22) to parse booleans into `1` or `0` instead of `true` or `false`:

```ts
const stream = new ShapeStream({
  url: `http://localhost:3000/v1/shape`,
  table: `foo`,
  parser: {
    bool: (value: string) => value === `true` ? 1 : 0
  }
})
```

#### Update Mode

By default Electric only sends the modified columns in an update message, not
the complete row. If your use case requires the receipt of the full row, not just
the modified columns, then set the `updateMode` of your `ShapeStream` to `full`:

```tsx
import { ShapeStream } from "@electric-sql/client"

const stream = new ShapeStream({
  url: `http://localhost:3000/v1/shape/foo`,
  updateMode: `full`,
})
```

This is less efficient and will use much more bandwidth for the same shape,
especially for tables with large static column values.

Shapes with differing `updateMode`s are distinct, even for the same table and
where clause combination.

### `Shape`

```tsx
import { ShapeStream, Shape } from '@electric-sql/client'

const stream = new ShapeStream({
  url: `http://localhost:3000/v1/shape`,
  table: `foo`,
})
const shape = new Shape(stream)

// Returns promise that resolves with the latest shape data once it's fully loaded
await shape.rows

// passes subscribers shape data when the shape updates
shape.subscribe(({ rows }) => {
  // rows is an array of the latest value of each row in a shape.
})
```

See the [Examples](https://github.com/electric-sql/electric/tree/main/examples) and [integrations](/docs/api/integrations/react) for more usage examples.
