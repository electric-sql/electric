# TypeScript client for ElectricSQL

Postgres sync for modern apps.

Electric provides an HTTP interface to Postgres to enable massive number of clients to query and get real-time updates to data in "shapes" i.e. subsets of the database. Electric turns Postgres into a real-time database.

The TypeScript client helps ease reading shapes over the API in the browser and in server JavaScript applications.

The TypeScript client supports both fine-grained and coarse-grained reactivity patterns. You can subscribe to see every row that changes or just to when the shape as a whole changes.

## Install

`npm i @electricsql/next`

## How to use

The client exports a `ShapeStream` class for getting updates to shapes on a row-by-row basis as well as a `Shape` class for getting updates to the entire shape.

### `ShapeStream`

```tsx
import { ShapeStream } from "electric-sql"

// passes subscribers rows as they're inserted, updated, or deleted
const fooShapeStream = new ShapeStream({
     shape: { table: `foo` },
     baseUrl: `${BASE_URL}`,
})

fooShapeStream.subscribe(messages => {
  // messages is 1 or more row updates
})
```

## `Shape`

```tsx
import { ShapeStream, Shape } from "electric-sql"

const shapeStream = new ShapeStream({ shape: { table: `foo` }, baseUrl: 'http://localhost:3000' })
const shape = new Shape(shapeStream)

// Returns promise that resolves with the latest shape data once it's fully loaded
await shape.value

// passes subscribers shape data when the shape updates
shape.subscribe(shapeData => {
  // shapeData is a Map of the latest value of each row in a shape.
}
```
