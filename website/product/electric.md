---
outline: deep
---

<img src="/img/icons/electric.svg" class="product-icon" />

# Electric Sync

Sync partial replicas of your data into local
apps and services.

## Use cases

The Electric Sync engine syncs subsets of data out of Postgres into local apps, services and environments &mdash; wherever you need the data.

<img srcset="/img/about/use-cases.sm.png 1098w, /img/about/use-cases.png 1484w"
    sizes="(max-width: 767px) 600px, 1484px"
    src="/img/about/use-cases.png"
    alt="Use cases diagramme"
/>

You can sync data into:

- web and mobile apps, [replacing data fetching with data sync](/examples/linearlite)
- development environments, for example syncing data into [an embedded PGlite](/product/pglite)
- edge workers and services, for example maintaining a low-latency [edge data cache](https://github.com/electric-sql/electric/blob/main/examples/redis-client/src/index.ts)
- local AI systems running RAG, for example [using pgvector](https://electric-sql.com/blog/2024/02/05/local-first-ai-with-tauri-postgres-pgvector-llama)
- databases like [PGlite](./pglite)

## How does it work?

The Electric sync engine is an [Elixir](https://elixir-lang.org) application, developed at [electric-sql/electric/tree/main/packages/sync-service](https://github.com/electric-sql/electric/tree/main/packages/sync-service).

It connects to your Postgres using a `DATABASE_URL`, consumes the logical replication stream and provides [an HTTP API](/docs/api/http) for replicating [Shapes](/docs/guides/shapes).

## How do I use it?

See the [Quickstart](/docs/quickstart) and [Examples](https://github.com/electric-sql/electric/tree/main/examples).
