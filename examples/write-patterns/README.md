# Write patterns example

This example demonstrates the four different [write-patterns](https://electric-sql.com/docs/guides/writes#patterns) from the [Writes](https://electric-sql.com/docs/guides/writes#patterns) guide. All running together, at the same time, within a single web application.

> ... screenshot ...

<!--
You can see the example deployed and running online at:
https://write-patterns.examples.electric-sql.com
-->

## Source code

There's some shared boilerplate in [`./shared`](./shared). The code implementing the different patterns is in the [`./patterns`](./patterns) folder.

### Patterns

All of the patterns [use Electric for read-path sync](https://electric-sql.com/product/sync) from Postgres into the local app. They each implement a different pattern for the write-path, (i.e.: how they handle local writes and get data from the local app back into Postgres).

- [`1-online-writes`](./patterns/1-online-writes) uses simple online writes through the backend API
- [`2-optimistic-state`](./patterns/2-optimistic-state) supports offline writes with simple optimistic state (no persistence)
- [`3-immutable-with-optimistic`](./patterns/3-immutable-with-optimistic) syncs into an immutable table, persists optimistic state in a shadow table and combines the two on read
- [`4-through-the-db`](./patterns/4-through-the-db) uses the local database as a unified mutable store, monitors changes, syncs them to the server &mdash; and keeps enough history and bookkeeping data around to be able to revert local changes when necessary

For more context about the patterns and their benefits and trade-offs, see the [Writes](https://electric-sql.com/docs/guides/writes#patterns) guide.

## How to run

1. Make sure you've installed all dependencies for the monorepo and built the packages:

From the monorepo root directory:

- `pnpm i`
- `pnpm run -r build`

2. Start the docker containers

In this directory:

`pnpm run backend:up`

3. Start the dev server

In this directory in another terminal:

`pnpm run dev`

4. When done, tear down the backend containers so you can run other examples

`pnpm run backend:down`
