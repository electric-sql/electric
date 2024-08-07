<p align="center">
  <a href="https://next.electric-sql.com" target="_blank">
    <picture>
      <source media="(prefers-color-scheme: dark)"
          srcset="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo-next.svg"
      />
      <source media="(prefers-color-scheme: light)"
          srcset="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo-black.svg"
      />
      <img alt="ElectricSQL logo"
          src="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo-black.svg"
      />
    </picture>
  </a>
</p>

<p align="center">
  <a href="https://github.com/electric-sql/electric/actions"><img src="https://github.com/electric-sql/electric/workflows/CI/badge.svg" alt="CI"></a>
  <a href="https://github.com/electric-sql/electric/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-green" alt="License - Apache 2.0"></a>
  <a href="https://github.com/electric-sql/electric-n
  ext/milestones"><img src="https://img.shields.io/badge/status-alpha-orange" alt="Status - Alpha"></a>
  <a href="https://discord.electric-sql.com"><img src="https://img.shields.io/discord/933657521581858818?color=5969EA&label=discord" alt="Chat - Discord"></a>
  <a href="https://x.com/ElectricSQL" target="_blank"><img src="https://img.shields.io/twitter/follow/ElectricSQL.svg?style=social&label=Follow @ElectricSQL"></a>
</p>

# TypeScript client for ElectricSQL

Real-time Postgres sync for modern apps.

Electric provides an [HTTP interface](https://next.electric-sql.com/api/http) to Postgres to enable a massive number of clients to query and get real-time updates to subsets of the database, called [Shapes](https://next.electric-sql.com//guides/shapes). In this way, Electric turns Postgres into a real-time database.

The TypeScript client helps ease reading Shapes from the HTTP API in the browser and other JavaScript environments, such as edge functions and server-side Node/Bun/Deno applications. It supports both fine-grained and coarse-grained reactivity patterns &mdash; you can subscribe to see every row that changes, or you can just subscribe to get the whole shape whenever it changes.

## Install

The client is published on NPM as [`@electric-sql/client`](https://www.npmjs.com/package/@electric-sql/client):

```sh
npm i @electric-sql/client
```

## How to use

The client exports a `ShapeStream` class for getting updates to shapes on a row-by-row basis as well as a `Shape` class for getting updates to the entire shape.

### `ShapeStream`

```tsx
import { ShapeStream } from 'electric-sql'

// Passes subscribers rows as they're inserted, updated, or deleted
const stream = new ShapeStream({
  url: `${BASE_URL}/v1/shape/foo`,
})

stream.subscribe(messages => {
  // messages is an array with one or more row updates
})
```

### `Shape`

```tsx
import { ShapeStream, Shape } from 'electric-sql'

const stream = new ShapeStream({
  url: `${BASE_URL}/v1/shape/foo`,
})
const shape = new Shape(stream)

// Returns promise that resolves with the latest shape data once it's fully loaded
await shape.value

// passes subscribers shape data when the shape updates
shape.subscribe(shapeData => {
  // shapeData is a Map of the latest value of each row in a shape.
}
```

See the [Docs](https://next.electric-sql.com) and [Examples](https://next.electric-sql.com/examples/basic) for more information.
