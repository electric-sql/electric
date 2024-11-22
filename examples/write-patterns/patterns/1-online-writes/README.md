
# Online writes example

This is an example of an application using:

- Electric for read-path sync, to sync data from into a local app
- online writes to write data back into Postgres from the local app

It's the simplest of the [write-patterns](https://electric-sql.com/docs/guides/writes#patterns) introduced in the [Writes](https://electric-sql.com/docs/guides/writes#patterns) guide.

> [!Tip] Other examples
> The [Phoenix LiveView example](../../../phoenix-liveview) also implements this pattern &mdash; using Electric to stream data into the LiveView client and normal Phoenix APIs to handle writes.

## Benefits

It's very simple to implement. It allows you [use your existing API](https://electric-sql.com/blog/2024/11/21/local-first-with-your-existing-api). It allows you to create apps that are fast and available offline for reading data.

Good use-cases include:

- live dashboards, data analytics and data visualisation
- AI applications that generate embeddings in the cloud
- systems where writes require online integration anyway, e.g.: making payments

## Drawbacks

Interactive applications won't work offline without implementing [optimistic writes with local optimistic state](../../optimistic-state).

## How to run

1. Make sure you've installed all dependencies for the monorepo and built the packages:

From the root directory:

- `pnpm i`
- `pnpm run -r build`

2. Start the backend services:

`pnpm run backend:up`

3. Start the client app:

`pnpm run dev`

4. When done, tear down the backend containers so you can run other examples

`pnpm run backend:down`
