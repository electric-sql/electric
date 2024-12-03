
# Through the DB sync example

This is an example of an application using:

- Electric for read-path sync
- local reads and writes to and from a single DB table
- shared, persistent optimistic state
- automatic change detection and background sync

The implementation builds on the approach of storing optimistic state in a local [PGlite](https://electric-sql.com/product/pglite) database, introduced in the [combine on read](../../3-combine-on-read) pattern and extends it to automatically manage optimistic state lifecycle, present a single table interface for reads and writes and auto-sync the local writes.

Specifically, we:

1. sync data into an immutable table, persist optimistic state in a shadow table and combine the two on read using a view
4. detect local writes, write them into a log of change messages and send these to the server

## Benefits

This provides full offline support, shared optimistic state and allows your components to purely interact with the local database. Data fetching and sending is abstracted away behind the Electric sync (for reads) and the change message log (for writes).

Good use-cases include:

- building local-first software
- interactive SaaS applications
- collaboration and authoring software

## Drawbacks

Combining data on-read makes local reads slightly slower. Using a local embedded database adds a relatively-heavy dependency to your app. The shadow table and trigger machinery complicate your client side schema definition.

## Complexities

This implementation has the same two key complexities as the [combine-on-read](../3-combine-on-read) example:

1. merge logic when recieving synced state from the server
2. handling rollbacks when writes are rejected

### 1. Merge logic

The entrypoint in the code for merge logic is the very blunt `delete_local_on_synced_trigger` defined in the [`./local-schema.sql`](./local-schema.sql). The current implementation just wipes any local state for a row when any insert, updater or delete to that row syncs in from the server.

This approach works and is simple to reason about. However, it won't preserve local changes on top of concurrent changes by other users (or tabs or devices). More sophisticated implementations could do more sophisticated merge logic here. Such as rebasing the local changes on the new server state. This typically involved maintaining more bookkeeping info and having more complex triggers.

### 2. Rollbacks

Syncing changes in the background complicates any potential rollback handling. In the [combine on read](../../3-combine-on-read) pattern, you can detect a write being rejected by the server whilst still in context, handling user input. With through the database sync, this context is harder to reconstruct.

In this example implementation, we implement an extremely blunt rollback strategy of clearing all local state and writes in the event of any write being rejected by the server.

You may want to implement a more nuanced strategy and, for example, provide information to the user about what is happening and / or minimise data loss by only clearing local-state that's causally dependent on a rejected write. This opens the door to a lot of complexity that may best be addressed by using an existing framework.

See the [Writes guide](https://electric-sql.com/docs/guides/writes) section on [Through the database sync](https://electric-sql.com/docs/guides/writes#through-the-database-sync) for more information and links to existing frameworks.

## How to run

See the [How to run](../../README.md#how-to-run) section in the example README.
