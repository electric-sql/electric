# electric-sql

## 0.12.2

### Patch Changes

- e518919d: Fix the Docker Compose file that's bundled with the client CLI to support databases that are only reachable over IPv6, such as Supabase.
- 5e2e276c: Fix `DELETE` statement batching causing call stack overflow and improve performance.
- a94e860c: Add clarifying documentation on behaviour `synced` promise returned by the `sync` API.
- 5b42c397: Add deprecation warnings to the public API methods of the DAL.
- af6a7be7: Extract drivers to separate package
- 837ce928: Extract the sync API out of the DAL and make the DAL optional.
- cb19c582: Extract CLI to a separate package.
- Updated dependencies [af6a7be7]
  - @electric-sql/drivers@0.0.2

## 0.12.1

### Patch Changes

- b3c1bdc: Minor performance improvements in downstream initial sync path
- e9dc60f: Update `better-sqlite3` dependency, dropping Node v16 support and adding Node v22 support, see [relevant PR](https://github.com/electric-sql/electric/pull/1378).
- 7bbba53: Modify FK flag option to default to disabling FK checks on SQLite.
- 7b4b8d4: Remove `WITHOUT ROWID` specification on SQLite migrations for improved performance (see https://github.com/electric-sql/electric/pull/1349).
- fbf8a4d: Modify setReplicationTransform to throw if a FK column is transformed.

## 0.12.0

### Minor Changes

- a8eedad: feat: server-driven unsubscribes to allow clients to unsubscribe from shapes

### Patch Changes

- f4f020d: Flag to disable FKs checks on incoming TXs in SQLite.
- 17e793c: Fix asyncEventEmitter to not silence unhandled exceptions raised in event handlers.
- d279c8a: Redact secrets from CLI Docker configuration printout.
- 81d91f5: Use canary Docker image tag when using the canary CLI client.
- d406e85: Use more widely supported regex features for SQL interpolation (remove negative lookbehind which has [limmited support](https://caniuse.com/js-regexp-lookbehind))
- d3506ab: Consistently use `URL` API for parsing and constructing URLs in CLI.
- d3506ab: Ensure default port numbers are used when starting Electric with CLI.
- 237e323: Better throttle snapshot stop strategy
- 17e793c: Fix `ShapeManager` bug where manager state gets reset but the Satellite process is still assuming it is accessible.
- 25523d9: Add experimental feature flag `ELECTRIC_FEATURES` environment variable to CLI options
- b966157: Expose `SyncStatus` type and methods for introspecting shape subscription status
- 276149d: Add notifier method `subscribeToShapeSubscriptionSyncStatusChanges` for listening to shape subscription status updates

## 0.11.3

### Patch Changes

- 6080c9c: Fix port collisions in client tests

## 0.11.2

### Patch Changes

- c4876dd7: Fix Postgres introspection subquery to only look at PK constraints
- ebd2cb93: Fix a bug with Postgres client sync so that pk columns for creating the ON CONFLICT statement are correct when applying an incoming transaction.

## 0.11.1

### Patch Changes

- f03bde05: Fix CLI bug for fetching migrations

## 0.11.0

### Minor Changes

- 450a65b3: Support for a local Postgres database on the client. Also introduces drivers for node Postgres and PGlite.

### Patch Changes

- c35956d6: Don't leave a snapshot running when stopping the Satellite process
- 5dd3975e: Fix bug with null values in INT8 (BigInt) columns.
- ca539551: Add `react-dom` and `@tauri-apps/plugin-sql` as optional peer dependencies.
- 0115a0a3: Add Zod and Prisma to (optional) peer dependencies.
- 22a7555a: Fix CLI `PROXY` option to correctly infer database name and not print introspection url.
- ec27052c: Remove max listener warning on `EventNotifier`'s event emitter.
- 22a7555a: Fix `ELECTRIC_` options not working as CLI arguments
- abebbaa2: Adding debug toolbar
- 244033ff: Ensure no snapshot is taken after closing the Satellite process.
- 3794e2b1: Fix duplicate `ROLLBACK`s when using interactive transactions through the adapter's `transaction` API.
- 244066af: Fix TextEncoder polyfill being fed numbers rather than strings and breaking replication of number types
- Updated dependencies [450a65b3]
  - @electric-sql/prisma-generator@1.1.5

## 0.10.1

### Patch Changes

- b7faf724: Fixed GC on the client after a server-requested reset if nested shapes are used

## 0.10.0

### Minor Changes

- 64c8f87e: Introduce shapes with relation following on server and client

### Patch Changes

- 494aebd9: Don't receive notifications when no table has changed
- 6adfe2e2: Fix queries trying to retrieve relations using `null` foreign keys.
- da1b6f6d: Fixed incorrect field transformation for queries with included relations
- a48bcdc3: Implement `setReplicationTransform` API on tables that allows transforming row fields at the replication boundary.
- 179e9945: Fix `op-sqlite` driver integration using HostObjects and failing to return results
- b7e99c88: Added support for BYTEA/BLOB column type across the sync service, TS client, and client generator
- Updated dependencies [d8ee5f0e]
- Updated dependencies [a48bcdc3]
- Updated dependencies [b7e99c88]
  - @electric-sql/prisma-generator@1.1.4

## 0.9.6

### Patch Changes

- a395ca62: Remove `react-native-get-random-values` as included dependency - waring fired instead and polyfill left to library user
- 0614254a: Fix clear tags not being set correctly resulting in wrong conflict resolution

## 0.9.5

### Patch Changes

- 85daa6ed: CLI support for Docker compose version 2.24.6 by removing inheritance from docker-compose files.
- eebd03cf: Fix bug in generic DB adapter that could lead to transaction lock not being released.
- 3d160018: Remove `db` field from `DatabaseAdapter` and export it to aid in external database adapter creation.
- 95dbb6b3: Fix Capacitor driver issue where `BEGIN` statements failed to run on Android by using driver's `execute` API.
- 758173c9: New adapter for supporting op-sqlite
- eae8a049: - Fix `react-native-sqlite-storage` implementation to use correct `dbname` attribtue
  - Refactor `react-native-sqlite-storage` implementation to use SerialDatabaseAdapter
- 595e8f99: Fix `upsert` causing double-serialization of JSON fields
- f058ffc4: Remove `react-native-get-random-values` as included dependency - waring fired instead and polyfill left to library user
- 55a0bf11: Export websocket implementations to enable use in custom drivers
- b65f3edf: Add `useConnectivityState` API to Vue.js bindings
- 5d95ce66: Fix TextEncoder and TextDecoder polyfills to work cross-platform
- ece1f126: Reverted CLI to use Prisma v4 instead of v5 because Prisma v5 introduces breaking type changes in the generated client which caused type errors in the generated Electric client.
- 95629057: Provide targeted polyfills for web API dependencies for compatibility with other runtimes
- b0b863bf: Fix race condition in performSnapshot. Changes can only be sent to remote when the outbound replication status is active
- a269b7cd: Fixes bug that would cause deleted rows to re-appear under specific conditions.
- 31384af1: Remove unused React hook and clean up `useLiveQuery` hook
- c30516ef: Fix issue with duplicate rows when including several relations.
- 8bfacdbb: Remove comments from client SQLite trigger migrations for better compatibility with drivers (e.g. see [this driver issue](https://github.com/capacitor-community/sqlite/issues/521)).
- a4d914ff: Remove `cordova-sqlite-storage` driver support
- d995920b: Remove `react-native-sqlite-storage` driver support
- 02ebef80: Bump minimum required version for `@capacitor-community/sqlite` driver to include fix to the [`executeSet` API issue](https://github.com/capacitor-community/sqlite/issues/521)

## 0.9.4

### Patch Changes

- dace3fc1: Restore support for both `sub` and `user_id` claim in auth JWTs

## 0.9.3

### Patch Changes

- d0bc48c2: Add basic Vue.js bindings for using live queries
- 223319ea: Add expo-sqlite/next driver to client
- 4d193eb1: Make `--debug` flag in CLI `generate` command always retain temporary migrations folders
- 5143a99c: Detach database electrification from connecting to the Electric sync service.
- 11069a90: Handle JWT expiration on the TS client, and support reconnecting after JWT expires.
- a968a636: Made connectivityState read-only and introduced a disconnect method.
- 0ebd3e2d: Added support for Tauri SQLite driver.
- 162d6e6e: Add row primary key infomation to the ActuallyChanged notification.

## 0.9.2

### Patch Changes

- 5fa4eebd: Modified the CLI's generate command to fix issues with the generator when user projects include Prisma v5.
- 6fc36865: Use SIGINT as the default stop signal for the Electric service started with `npx electric-sql start`. This results in faster shutdown after pressing Ctrl-C or stopping all services with `docker compose stop/down`.
- a5a54fb3: - Add `ELECTRIC_WRITE_TO_PG_MODE` as option to CLI
  - Fix CLI option defaults to match Electric defaults
- 39fc2ac7: Fix clearing local state to avoid FK violations.

## 0.9.1

### Patch Changes

- 6ad33249: Hide proxy password in generate command output Fixes VAX-1548
- 3605f291: Correctly pass the CONTAINER_NAME to the cli "status" command
- 356359a2: CLI - Split inferred values from default values (VAX-1569)
- e5d7a6dc: Validate that the --with-migrations command successfully ran before generating client
- 4f19a086: [VAX-1544] Map http(s) scheme in service URL to ws(s) when starting a proxy tunnel.
- bac15160: CLI - Silent dot-env warning when there are no .env files
- fb2eba1c: Fix redundant query calls in React live query hook implementation
- 8a97cc9f: Updated docstring for generic database adapter.
- 3a617982: Upgrade Prisma dependency to 5.2 in the client, Fixes VAX-1524

## 0.9.0

### Minor Changes

- 2e233c01: Redesigned command-line interface featuring a new suite of commands, support for .env configuration, local-only-first mode and streamlined development experience.

### Patch Changes

- bc0d91d5: Ensure migrations CLI failure test always fails
- de1c848b: - Fixed SQLite table name parsing for windowed queries and removed deprecated sqlite parser dependency
  - Made the `raw` API throw for unsafe queries, i.e. anything other than read-only queries, to match `liveRaw`'s behaviour
  - Added an `unsafeExec` API to allow modifying the store directly via the client
- 9f38fa44: Change build tooling for the client to `tsup`, enable source maps in our distribution, and improve typescript nodenext project support.
- b840606a: Fix default socket for capacitor driver.
- ff343753: Fix bug with foreign keys in generate script.
- e11501d8: - Fix generator not cleaning up temporary migrations folder on error.
  - Add --debug flag to generator for option to retain migrations folder on error for inspection.
  - Add temporary migration folder to gitignore in starter template
- 4fe5c7f6: Adds client-side support for enumerations.
- ff3ba0cb: Make the `locateSqliteDist` argument `ElectricDatabase.init` optional, this allows bundlers to find and bundle the wa-sqlite wasm file.
- 4ae19469: Modified interface of the generic database adapter and modified the drivers accordingly.
- 587899f7: Added new names for raw query APIs (`rawQuery`, `liveRawQuery`, and `unsafeExec`) and deprecated old ones (`raw` and `liveRaw`)
- Updated dependencies [d3cf7043]
- Updated dependencies [4fe5c7f6]
  - @electric-sql/prisma-generator@1.1.3

## 0.8.2

### Patch Changes

- 0dfb35d8: [VAX-1324] Prevent updates to table PKs
- 9ffb11aa: Modify Satellite client to use async event emitter.
- 9676b4d0: New "npx electric-sql proxy-tunnel" command that tunnels a Postgres TCP connection over a websocket for the Postgres Proxy.
- 4fc11d3a: Capacitor sqlite DB driver re-implemented to extend the new generic BatchDatabaseAdapter.
- 071175d4: Improve Windows support
- d5cdbf10: Prisma and the electric client generator are now dependencies of the client, you no longer have to include them as dependencies of a project using Electric. Projects can also depend on a different version of Prisma to the one used by Electric.
- 9a32ea9f: Fix bug with BigInt primary keys.
- Updated dependencies [22652fb3]
- Updated dependencies [38e1e44b]
  - @electric-sql/prisma-generator@1.1.2

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
