
# Combine on read example

This is an example of an application using:

- Electric for read-path sync
- local optimistic writes with shared, persistent optimistic state

This pattern can be implemented with a variety of client-side state management and storage mechanisms. For example, we have a [TanStack example](../../../tanstack-example) that uses the TanStack mutation cache for shared optimistic state.

In this implementation, we use Electric together with [PGlite](https://electric-sql.com/product/pglite). Specifically, we:

1. sync data into an immutable table
2. persist optimistic state in a shadow table
3. combine the two on read using a view

We also show how to use triggers in the local PGlite data model to:

- automatically manage optimistic state lifecycle
- present a single table interface for reads and writes

## Benefits

This is a powerful and pragmatic pattern, occupying a compelling point in the design space. It's relatively simple to implement. Persisting optimistic state makes local writes more resilient.

Storing optimistic state in a shared table allows all your components to see and react to it. This avoids one of the weaknesses with component-scoped optimistic state with a [more naive optimistic state pattern](../2-optimistic-state) and makes this pattern more suitable for more complex, real world apps.

Seperating immutable synced state from mutable local state makes it easy to reason about and implement rollback strategies.

Good use-cases include:

- building local-first software
- interactive SaaS applications
- collaboration and authoring software

## Drawbacks

Combining data on-read makes local reads slightly slower.

Using a local embedded database adds a relatively-heavy dependency to your app. This impacts build/bundle size, initialization speed and memory use. The shadow table and trigger machinery complicate your client side schema definition.

Whilst the database is used for local optimistic state, writes are still made via an API. This can often be helpful and pragmatic, allowing you to [re-use your existing API](https://electric-sql.com/blog/2024/11/21/local-first-with-your-existing-api). However, you may want to avoid running an API and leverage [through the DB sync](../../3-through-the-db) for a purer local-first approach.

## How to run

See the [How to run](../../README.md#how-to-run) section in the example README.
