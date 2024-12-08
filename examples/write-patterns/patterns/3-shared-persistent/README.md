
# Shared persistent optimistic state pattern

This is an example of an application using:

- Electric for read-path sync
- local optimistic writes with shared, persistent optimistic state

This pattern can be implemented with a variety of client-side state management and storage mechanisms. This example uses [valtio](https://valtio.dev) for a shared reactive store and persists this store to localStorage on any change. This allows us to keep the code very similar to the previous [`../2-optimistic-state`](../2-optimistic-state) pattern (with a valtio `useSnapshot` and a custom reduce function playing almost exactly the same role as the React `useOptimistic` hook).

## Benefits

This is a powerful and pragmatic pattern, occupying a compelling point in the design space. It's relatively simple to implement. Persisting optimistic state makes local writes more resilient.

Storing optimistic state in a shared store allows all your components to see and react to it. This avoids one of the weaknesses with component-scoped optimistic state with a [more naive optimistic state pattern](../2-optimistic-state) and makes this pattern more suitable for more complex, real world apps.

Seperating immutable synced state from mutable local state makes it easy to reason about and implement rollback strategies. The entrypoint for handling rollbacks has the local write context as well as the shared store, so it's easy to make rollbacks relatively surgical.

Good use-cases include:

- building local-first software
- interactive SaaS applications
- collaboration and authoring software

## Drawbacks

Combining data on-read makes local reads slightly slower.

Writes are still made via an API. This can often be helpful and pragmatic, allowing you to [re-use your existing API](https://electric-sql.com/blog/2024/11/21/local-first-with-your-existing-api). However, you may want to avoid running an API and leverage [through the DB sync](../4-through-the-db) for a purer local-first approach.

## Implementation notes

The merge logic in the `matchWrite` function supports rebasing local optimistic state on concurrent updates from other users.

This differs from the previous optimistic state example, in that it matches inserts and updates on the `write_id`, rather than the `id`. This means that concurrent updates to the same row will not
clear the optimistic state, which allows it to be rebased on changes made concurrently to the same data by other users.

Note that we still match deletes by `id`, because delete operations can't update the `write_id` column. If you'd like to support revertable concurrent deletes, you can use soft deletes (which are obviously actually updates).

## How to run

See the [How to run](../../README.md#how-to-run) section in the example README.
