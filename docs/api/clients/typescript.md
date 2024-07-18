---
outline: deep
---

# TypeScript client

The client is defined in [packages/typescript-client](https://github.com/electric-sql/electric-next/tree/main/packages/typescript-client). It provides [ShapeStream](#shapestream) and [Shape](#shape) primitives to stream and materialize shapes.

## Use cases

Real-time Postgres sync for modern apps.

Electric provides an [HTTP interface](/api/http) to Postgres to enable a massive number of clients to query and get real-time updates to subsets of the database, called [Shapes](/guides/shapes). In this way, Electric turns Postgres into a real-time database.

The TypeScript client helps ease reading Shapes from the HTTP API in the browser and other JavaScript environments, like edge functions and server-side JavaScript applications. It supports both fine-grained and coarse-grained reactivity patterns &mdash; you can subscribe to see every row that changes, or you can just subscribe to get the whole shape whenever it changes.

## Install

The client is published on NPM as [`@electric-sql/next`](https://www.npmjs.com/package/@electric-sql/next):

```sh
npm i @electric-sql/next
```

## How to use

The client exports a `ShapeStream` class for getting updates to shapes on a row-by-row basis as well as a `Shape` class for getting updates to the entire shape.

### `ShapeStream`

```tsx
import { ShapeStream } from '@electric-sql/next'

// Passes subscribers rows as they're inserted, updated, or deleted
const stream = new ShapeStream({
  baseUrl: `${BASE_URL}`,
  shape: { table: `foo` }
})

stream.subscribe(messages => {
  // messages is an array with one or more row updates
})
```

### `Shape`

```tsx
import { ShapeStream, Shape } from '@electric-sql/next'

const stream = new ShapeStream({
  baseUrl: `${BASE_URL}`,
  shape: { table: `foo` }
})
const shape = new Shape(stream)

// Returns promise that resolves with the latest shape data once it's fully loaded
await shape.value

// passes subscribers shape data when the shape updates
shape.subscribe(shapeData => {
  // shapeData is a Map of the latest value of each row in a shape.
}
```

See the [Examples](/examples/basic) and [Connectors](/api/connectors/react) for more usage examples.
