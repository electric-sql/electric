# electric-sql

## 0.8.1

### Patch Changes

- fab106c4: Properly escape path for Windows in the generator.

## 0.8.0

### Minor Changes

- eb722c9b: [VAX-1335] Create new protocol op to represent a compensation

### Patch Changes

- fb773fbb: Dispose listeners when Electric client is closed.
- 863f9f37: Fix critical section of wa-sqlite DB adapter to avoid bad interleavings.
- 5c4a85d4: Generic implementation of serial and batched database adapters.
- a9bb17ca: Upgrade wa-sqlite version because of a critical bug fix in wa-sqlite.
- 0ad1867b: Fix assertions in unit tests.
- 3ed54698: Fix race condition in process.subscribe that made the client crash.
- 4ad7df4d: [VAX-825] Add client-side support for JSON type.
- 1fe8c7d6: Rely on Prisma's conversion of PG table names to Prisma model names. No longer turn snake_cased table names into PascalCased model names.
- cf0f0963: Add comment about possibly receiving empty subsData when handling SubscriptionData message on Satellite
- e2da540c: Windows support for the generator.
- e091bbfb: Refactorings to the event notifier.

## 0.7.1

### Patch Changes

- dae6e7b2: Improved client events type safety
- 1016d4b3: Use localhost instead of 127.0.0.1 as default address for Electric.
  Update documentation of command-line options for the CLI's generate command.
- 5da426d8: Fix bug where data types provided in input structures could not be bound to SQLite types.
- fe39c002: Fix #627, incorrect peer dependency for Capacitor SQLite
- 6c87d8f6: Fix bug where SQL complains about syntax error near "from" due to table names and column names not being quoted in the generated triggers.

## 0.7.0

### Minor Changes

- d109a1e7: Major new release that introduces Electric Postgres Proxy, affecting all Electric components.

### Patch Changes

- 0e24343d: [VAX-1078] Fix the issue where the client was unable to sync local writes of whole numbers to float columns.
- d60e9ce5: handle exceptions properly in \_performSnapshot
- 226c0048: Fix bug for table named "model"
- d5ed97fc: prevent reconnect loop of doom on fatal errors
- 449e7fef: Improve type-safety of the client
- 318b26d6: Adds client-side support for booleans.
- 00eb469d: Adds client-side support for float8 data type.
- b5ba4823: Fix error that table already exists when re-generating client after having previously received a migration over the replication stream.
- 3d98c1f6: New DB driver for capacitor-sqlite.
- c1d637e3: Bump minimum capacitor-community/sqlite version to enable Android support
- 88a53756: Adds client-side support for int2 and int4 types.
- 3ae3f30a: Adds client-side support for timestamps, times, and dates.
- 3fdb2890: Cleanup startingPromise in registry when the Satellite process fails to start
- cfded697: Modify CLI to introspect Postgres database through Electric's proxy.
- 9e9faf8b: Fixes bug with DB driver for expo-sqlite on Android.
- 88a53756: Add client-side validations for UUIDs.

## 0.6.4

### Patch Changes

- 5a0f922: Fix the bug where the client would crash/stop working/stop syncing if it received a migration containing a new index creation.

## 0.6.3

### Patch Changes

- 3c0a4ca: Relax the client-side migration version validation to allow an arbitrary suffix to follow the version itself.

## 0.6.2

### Patch Changes

- 406089d: Publically expose the version module.

## 0.6.1

### Patch Changes

- a658123: Remove node debugging detection because it broke Webpack builds

## 0.6.0

### Minor Changes

- 2662251: Add protocol version negotiation to websocket connection step
- e5936a6: feat: changed the protocol to have a proper RPC implementation for ease of extension and maintanence

### Patch Changes

- 3603703: Use parametrized SQL queries.

## 0.5.3

### Patch Changes

- 8f901a2: Enable foreign_keys pragma on startup.

## 0.5.2

### Patch Changes

- 3ba6c5d: Fixed conflict resolution issue leading to a wrong state on the client
- 7f3d691: Make client try to reconnect to server when connection is lost
- 34af0ec: Fixed incorrect snapshotting issue which led to weird behaviours

## 0.5.1

### Patch Changes

- 6a7c6be: Increase max listener limit on shared global event emitter instance to avoid unnecessary warnings.

## 0.5.0

### Minor Changes

- 69d13c4: Large rewrite, that introduces Data Access Library, client-side migration application, and subscriptions.

  This release encompasses quite a bit of work, but this is still considered an unstable release and so this is only a minor version bump.
  We intend to keep this and the `components/electric` server sync layer somewhat in sync on minor versions up to `1.0.0`: new features that require both server-side support as well as client-side support are going to result in a minor-level version bump on both, while features/improvements that don't need both sides will be marked as a patch version.

  Data access library exposes a prisma-like interface to interact with SQLite (any platform works, including web). On top of that, we introduce a `.sync()` interface which establishes a subscription with the server to get initial data and changes for the tables we're interested in.

  Server now knows how to send migrations to the clients as soon as they get applied to the underlying PostgreSQL database, and this client version applies them to the local database.

  Server now knows how to handle subscriptions and reconnection a bit better, which the client makes use of (in particular, this heavily improves initial sync performance).

### Patch Changes

- 5567869: Use PascalCased model names in generated Prisma schema and map them to the original table names.
- dc48f1f: Fixed `liveMany`, `liveUnique`, and `liveFirst` functions not exposing the `include` tables properly, making `useLiveQuery` miss some relevant updates
- c588bdf: Fixed not sending all the transactions if more than one was done within a throttle window
- 0bcc92c: Added a uniqueTabId utility function for apps that want to use tab-scoped DB names.
- 1c20e29: Improve starter template output and introduced new db:connect command.
- 4531dde: Fix unreliable behaviour in the React `useConnectivityState` hook.
- 49c4b35: Allowed `https:` protocol in service connections for CLI
- f60ce16: Implemented correct semantics for compensations to work across the stack
- b29693e: Modify generated migrations file to be a .ts file instead of .js file
- 18619ef: Fixed race condition in throttled perform snapshot
- 232f7a5: Updated snapshotting function to be more efficient when handling a large oplog
- edfb298: Improved subscription data insertion to do batched inserts instead of one-by-one statements. Inserting a lot of data should be much faster.
- 525c8d1: Moved CLI dependency from dev to prod dependency list
- a112a03: Fixed Satellite not handling mutliple concurrent subscription calls properly
- bd02d79: Fixed garbage collection on shape unsubscribe (also called on subscription errors), which caused the DELETEs performed by GC get noted in operations log and sent to the server, causing data loss
- 49cbe27: Fixed using `.sync()` calls before the replication is established. Now we defer trying to subscribe until the replication is succesfully established if we're already in the process of connecting and starting.
- 3345cf8: Bugfix: update the `wa-sqlite` driver to use the `WebSocketFactory`.
- 2e8bfdf: Fixed the client not being able to reconnect if the migrations were preloaded and the only operation was a subscription. In that case the client have never received any LSNs (because migrations didn't need to be sent), so reconnection yielded errors due to missing LSN but existing previously fulfilled subscriptions. We now send the LSN with the subscription data so even if it's the first and only received message, the client has enough information to proceed.
- 345cfc6: Added auth.insecureAuthToken function and updated examples to use it.
- c30483f: Fixed conflicts when using multiple instances of Electric on the same page
- 93d7059: Fixed calls to the `.sync()` function when page reloads establishing a new subscription alongside existing one. Now we deduplicate subscription requests by hash of their contents, so no two exactly the same subscriptions are possible. This also solves calling `<table>.sync()` many times in multiple components - they will return the same promise.
- 80531f0: Fixed subscription being registered too late preventing deduplication
- 10bbae9: Moved `better-sqlite3` to dependencies because CLI command uses it
- 3cb872d: Chore: made `_getMeta` types more precise
- 9db6891: Also fix casing in types that refer to model names
- e165048: Fixed subscription data not triggering data changed notification and thus `liveQuery` not working as expected
- d359cae: Made argument of liveMany optional.
- 7eab08e: Improved `config.url` parsing and SSL support.
- 8209293: Fixed reconnect issues when the client is too far behind the server
- f4184b1: Fix: ensure we do much more cleanup in `useEffect` returned functions and in `close` method of Satellite

## 0.5.0-next.8

### Patch Changes

- 0bcc92c: Added a uniqueTabId utility function for apps that want to use tab-scoped DB names.
- 345cfc6: Added auth.insecureAuthToken function and updated examples to use it.

## 0.5.0-next.7

### Patch Changes

- c30483f: Fixed conflicts when using multiple instances of Electric on the same page

## 0.5.0-next.6

### Patch Changes

- 1c20e29: Improve starter template output and introduced new db:connect command.
- f60ce16: Implemented correct semantics for compensations to work across the stack
- 8209293: Fixed reconnect issues when the client is too far behind the server

## 0.5.0-next.5

### Patch Changes

- d359cae: Made argument of liveMany optional.

## 0.5.0-next.4

### Patch Changes

- 5567869: Use PascalCased model names in generated Prisma schema and map them to the original table names.
- dc48f1f: Fixed `liveMany`, `liveUnique`, and `liveFirst` functions not exposing the `include` tables properly, making `useLiveQuery` miss some relevant updates
- c588bdf: Fixed not sending all the transactions if more than one was done within a throttle window
- 4531dde: Fix unreliable behaviour in the React `useConnectivityState` hook.
- b29693e: Modify generated migrations file to be a .ts file instead of .js file
- 18619ef: Fixed race condition in throttled perform snapshot
- 232f7a5: Updated snapshotting function to be more efficient when handling a large oplog
- 10bbae9: Moved `better-sqlite3` to dependencies because CLI command uses it
- 3cb872d: Chore: made `_getMeta` types more precise
- 9db6891: Also fix casing in types that refer to model names
- 7eab08e: Improved `config.url` parsing and SSL support.
- f4184b1: Fix: ensure we do much more cleanup in `useEffect` returned functions and in `close` method of Satellite

## 0.5.0-next.3

### Patch Changes

- edfb298: Improved subscription data insertion to do batched inserts instead of one-by-one statements. Inserting a lot of data should be much faster.
- a112a03: Fixed Satellite not handling mutliple concurrent subscription calls properly
- 3345cf8: Bugfix: update the `wa-sqlite` driver to use the `WebSocketFactory`.
- 80531f0: Fixed subscription being registered too late preventing deduplication
- e165048: Fixed subscription data not triggering data changed notification and thus `liveQuery` not working as expected

## 0.5.0-next.2

### Patch Changes

- bd02d79: Fixed garbage collection on shape unsubscribe (also called on subscription errors), which caused the DELETEs performed by GC get noted in operations log and sent to the server, causing data loss
- 49cbe27: Fixed using `.sync()` calls before the replication is established. Now we defer trying to subscribe until the replication is succesfully established if we're already in the process of connecting and starting.
- 2e8bfdf: Fixed the client not being able to reconnect if the migrations were preloaded and the only operation was a subscription. In that case the client have never received any LSNs (because migrations didn't need to be sent), so reconnection yielded errors due to missing LSN but existing previously fulfilled subscriptions. We now send the LSN with the subscription data so even if it's the first and only received message, the client has enough information to proceed.
- 93d7059: Fixed calls to the `.sync()` function when page reloads establishing a new subscription alongside existing one. Now we deduplicate subscription requests by hash of their contents, so no two exactly the same subscriptions are possible. This also solves calling `<table>.sync()` many times in multiple components - they will return the same promise.

## 0.5.0-next.1

### Patch Changes

- 49c4b35: Allowed `https:` protocol in service connections for CLI
- 525c8d1: Moved CLI dependency from dev to prod dependency list

## 0.5.0-next.0

### Minor Changes

- 69d13c4: Large rewrite, that introduces Data Access Library, client-side migration application, and subscriptions.

  This release encompasses quite a bit of work, but this is still considered an unstable release and so this is only a minor version bump.
  We intend to keep this and the `components/electric` server sync layer somewhat in sync on minor versions up to `1.0.0`: new features that require both server-side support as well as client-side support are going to result in a minor-level version bump on both, while features/improvements that don't need both sides will be marked as a patch version.

  Data access library exposes a prisma-like interface to interact with SQLite (any platform works, including web). On top of that, we introduce a `.sync()` interface which establishes a subscription with the server to get initial data and changes for the tables we're interested in.

  Server now knows how to send migrations to the clients as soon as they get applied to the underlying PostgreSQL database, and this client version applies them to the local database.

  Server now knows how to handle subscriptions and reconnection a bit better, which the client makes use of (in particular, this heavily improves initial sync performance).
