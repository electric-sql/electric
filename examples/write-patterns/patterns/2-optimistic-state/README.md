
# Optimistic state example

This is an example of an application using:

- Electric for read-path sync, to sync data from into a local app
- local-optimistic writes using React's built-in [`useOptimistic`](https://react.dev/reference/react/useOptimistic) hook

This allows writes to be displayed locally immediately, by merging temporary optimistic state into the synced todo list before rendering. If the app (or API) is offline, then the writes are retried following a backoff algorithm and should eventually succeed when the app (or API) comes back online.

When the writes do succeed, they are automatically synced back to the app via Electric and the local optimistic state is discarded.

## Benefits

Simple to implement. Allows you [use your existing API](https://electric-sql.com/blog/2024/11/21/local-first-with-your-existing-api). Takes the network off the write path. Allows you to create apps that are fast and available offline for both reading and writing data.

Good use-cases include:

- management apps and interactive dashboards
- apps that want to feel fast and avoid loading spinners on write
- mobile apps that want to be resilient to patchy connectivity

## Drawbacks

The local optimistic state is not persistent. Optimistic state is managed within the component. This can become tricky to manage when state is shared across components. More complex apps may benefit from the more comprehensive [combine on read](../../3-combine-on-read) pattern.

## How to run

See the [How to run](../../README.md#how-to-run) section in the example README.
