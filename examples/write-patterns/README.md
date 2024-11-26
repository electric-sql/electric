# Write patterns example

This example demonstrates the four different [write-patterns](https://electric-sql.com/docs/guides/writes#patterns) described in the [Writes](https://electric-sql.com/docs/guides/writes#patterns) guide.

All running together, at the same time, within a single web application.

> ... screenshot ...

<!--
You can see the example deployed and running online at:
https://write-patterns.examples.electric-sql.com
-->

## Source code

There's some shared boilerplate in [`./shared`](./shared). The code implementing the different patterns is in the [`./patterns`](./patterns) folder.

### Patterns

All of the patterns use [Electric](https://electric-sql.com/product/sync) for the read-path (i.e.: syncing data from Postgres into the local app) and implement a different approach to the write-path (i.e.: how they handle local writes and get data from the local app back into Postgres):

- [`1-online-writes`](./patterns/1-online-writes) works online, writing data through the backend API
- [`2-optimistic-state`](./patterns/2-optimistic-state) supports offline writes with simple optimistic state (component-scoped, no persistence)
- [`3-combine-on-read`](./patterns/3-combine-on-read) syncs into an immutable table, persists optimistic state in a shadow table and combines the two on read
- [`4-through-the-db`](./patterns/4-through-the-db) uses the local database as a unified mutable store, syncs changes to the server and keeps enough history and bookkeeping data around to be able to revert local changes when necessary

For more context about the patterns and their benefits and trade-offs, see the [Writes](https://electric-sql.com/docs/guides/writes#patterns) guide.

## How to run

Make sure you've installed all dependencies for the monorepo and built the packages (from the monorepo root directory):

```shell
pnpm install
pnpm run -r build
```

Start the docker containers (in this directory):

```shell]
pnpm run backend:up
```

Start the dev server:

```shell
pnpm run dev
```

When done, tear down the backend containers so you can run other examples:

```shell
pnpm run backend:down
```
