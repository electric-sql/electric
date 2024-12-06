
# Through-the-database sync pattern

This is an example of an application using:

- Electric for read-path sync
- local reads and writes to and from a single DB table
- shared, persistent optimistic state
- automatic change detection and background sync

The implementation uses a local embedded [PGlite](https://electric-sql.com/product/pglite) database, to store both synced and local optimistic state. It automatically manages optimistic state lifecycle, presents a single table interface for reads and writes and auto-syncs the local writes.

Specifically, we:

1. sync data into an immutable table
2. persist optimistic state in a shadow table
3. combine the two on read using a view

Plus for the write path sync, we:

4. detect local writes
5. write them into a change log table
6. POST the changes to the API server

## Benefits

This provides full offline support, shared optimistic state and allows your components to interact purely with the local database. No coding over the network is needed. Data fetching and sending is abstracted away behind the Electric sync (for reads) and the change message log (for writes).

Good use-cases include:

- building local-first software
- mobile and desktop applications
- collaboration and authoring software

## Drawbacks

Using a local embedded database adds a relatively-heavy dependency to your app. The shadow table and trigger machinery complicate your client side schema definition.

Syncing changes in the background complicates any potential rollback handling. In the [shared persistent optimistic state](../../3-shared-persistent) pattern, you can detect a write being rejected by the server whilst still in context, handling user input. With through the database sync, this context is harder to reconstruct.

## Implementation notes

The merge logic in the `delete_local_on_synced_insert_and_update_trigger` in [`./local-schema.sql`](./local-schema.sql) supports rebasing local optimistic state on concurrent updates from other users.

The rollback strategy in the `rollback` method of the `ChangeLogSynchronizer` in [`./sync.ts`](./sync.ts) is very naive: clearing all local state and writes in the event of any write being rejected by the server. You may want to implement a more nuanced strategy. For example, to provide information to the user about what is happening and / or minimise data loss by only clearing local-state that's causally dependent on a rejected write.

This opens the door to a lot of complexity that may best be addressed by using an existing framework. See the [Writes guide](https://electric-sql.com/docs/guides/writes) for more information and links to [existing frameworks](https://electric-sql.com/docs/guides/writes#tools).

## How to run

See the [How to run](../../README.md#how-to-run) section in the example README.
