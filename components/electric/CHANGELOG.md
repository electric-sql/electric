# @core/electric

## 0.6.3

### Patch Changes

- ce30518: Correctly detect cases where the clients are ahead of WAL window, which may happen in case of a DB reset, like in development

## 0.6.2

### Patch Changes

- 704b237: Make sure the database name in the slot is escaped to match PG requirements (a-z, 0-9, \_ and less then 64 chars)

## 0.6.1

### Patch Changes

- 5f44c1a: Suffix electric-created slot with db name to be able to run Electric per database on a single PostgreSQL instance

## 0.6.0

### Minor Changes

- 2662251: Add protocol version negotiation to websocket connection step
- e5936a6: feat: changed the protocol to have a proper RPC implementation for ease of extension and maintanence

### Patch Changes

- cf4ee7c: Implement support for the BOOLEAN column type in electrified tables
- 75b2fcf: Implement support for the DATE column type in electrified tables.
- da9a718: Rewrite the type-validating part of `electify` function to expand allowed types when Electric instance is upgraded
- 4bd9ea2: Fix the problem where Postgres was failing to re-establish a replication connection to Electric after a restart
- 1dd9500: Remove int8 from the list of supported types supported in electrified tables.
- 3c47193: Implement support for electrifying and syncing tables that have columns types timestamp and timestamptz
- de1c571: VAX-911 - store client lsn position in postgres
- a4c5ce6: VAX-1036 - fixes bugs reported by @hugodutka by preventing insertion of duplicate ddl commands in migration history
- 33ed7e8: Implement support for the TIME column type in electrified tables.
- 76b15a6: Implement support for the UUID column type in electrified tables.
- 4bbe283: Adds opt-out telemetry about Electric usage stats, configurable with `ELECTRIC_TELEMETRY`.

## 0.5.3

### Patch Changes

- 30d7c38: Unified `HTTP_API_PORT` and `WEBSOCKET_PORT` into `HTTP_PORT` to serve both `/api` and `/ws` requests

## 0.5.2

### Patch Changes

- 73c703f: Fixed an issue with transactions not propagating to PG after Electric restart

## 0.5.1

### Patch Changes

- 5bec40a: Fixed multiple operations touching the same row within a tx not being applied properly on PG
- 212ec8d: Fixed a bug with lost writes when PG dropped the replication connection

## 0.5.0

### Minor Changes

- 69d13c4: Rewritten the Electric sync layer to remove Vaxine and enable partial replication

  This release encompasses quite a bit of work, which resulted in a complete overhaul of the current system. It's hard to note all changes, see git history for that, but this public release
  marks the first somewhat stable version of the system for which we intend incremental changes.

  That said, this is still considered an unstable release and so this is only a minor version bump.
  We intend to keep this and the `electric-sql` typescript library somewhat in sync on minor versions up to `1.0.0`: new features that require both server-side support as well as client-side support are going to result in a minor-level version bump on both, while features/improvements that don't need both sides will be marked as a patch version.

  Rough change list between previous version and this one:

  - Removed Antidote (Vaxine) from the system
  - Moved CRDT conflict resolution into GitHub using special observed operations CRDT form
  - Streamlined the deployment heavily by relying now on unpatched Postgres
  - Removed the Postgres-to-Postgres replication
  - Added the concept of "electrified" tables - only those can be synced to the client
  - Added PG-managed migrations instead of relying on an external system (previously, our cloud console) to manage them
  - Added migration propagation to the client so that the server may dictate table creation to the clients
  - Heavily improved initial sync story: we don't send the entire Antidote write-ahead log on connect, we send actual data queried from Postgres and then start streaming the changes
  - Added the first iteration of partial replication, where the client subscribes to tables they are interested in instead of the all available tables

### Patch Changes

- f8cf910: Remove SchemaRegistry and use our cached knowledge of the pg schema to fulfill all requirements for knowledge of the replicated tables
- 5fe00af: Fixed sync from subscription not respecting `electric_user_id` filtering
- afaedcd: Make some configuration option names more descriptive. Namely,

  - rename `ELECTRIC_HOST` to `LOGICAL_PUBLISHER_HOST`
  - rename `POSTGRES_REPLICATION_PORT` to `LOGICAL_PUBLISHER_PORT`
  - rename `STATUS_PORT` to `HTTP_API_PORT`

  The first two options together define the host:port pair that the PostgreSQL database will connect to
  in order to start following Electric's logical replication stream that publishes inbound changes from all clients.

  The `HTTP_API_PORT` option is now more aptly named since Electric exposes more than just the status endpoint
  on that port.

- 6026ced: Update all deps that had new backwards-compatible versions
- 11acadd: Allow for enabling SSL for PG connections via an env variable
- 57324c4: Add server-side validation of row values incoming from Satellite clients
- 089968d: Fixed the issue whereby calling electrify() on a previously electrified table caused a duplicate migration to be created and put onto the replication stream.
- f60ce16: Implemented correct semantics for compensations to work across the stack
- 3cf2bc2: Support for intersecting shape subscriptions
- 8b8cc93: Fix a bug in schema version validation
- e17b37e: Fix the bug where the client failed to restart the replication connection after completing the initial sync once.
- 2e8bfdf: Fixed the client not being able to reconnect if the migrations were preloaded and the only operation was a subscription. In that case the client have never received any LSNs (because migrations didn't need to be sent), so reconnection yielded errors due to missing LSN but existing previously fulfilled subscriptions. We now send the LSN with the subscription data so even if it's the first and only received message, the client has enough information to proceed.
- e4cbf80: Update Elixir to 1.15.4 to fix remote shell
- 571119a: Add a validation step in the electrify() function that only lets tables with supported column types to be electrified
- 3ca4917: Fixed an issue where sometimes subscription data would not be sent in absence of other writes to PG
- 00d5a67: Add server-side enforcement of "NOT NULL" for values incoming from Satellite clients

## 0.5.0-next.6

### Patch Changes

- 11acadd: Allow for enabling SSL for PG connections via an env variable
- 57324c4: Add server-side validation of row values incoming from Satellite clients
- f60ce16: Implemented correct semantics for compensations to work across the stack
- 3cf2bc2: Support for intersecting shape subscriptions
- 571119a: Add a validation step in the electrify() function that only lets tables with supported column types to be electrified
- 00d5a67: Add server-side enforcement of "NOT NULL" for values incoming from Satellite clients

## 0.5.0-next.5

### Patch Changes

- 5fe00af: Fixed sync from subscription not respecting `electric_user_id` filtering
- afaedcd: Make some configuration option names more descriptive. Namely,

  - rename `ELECTRIC_HOST` to `LOGICAL_PUBLISHER_HOST`
  - rename `POSTGRES_REPLICATION_PORT` to `LOGICAL_PUBLISHER_PORT`
  - rename `STATUS_PORT` to `HTTP_API_PORT`

  The first two options together define the host:port pair that the PostgreSQL database will connect to
  in order to start following Electric's logical replication stream that publishes inbound changes from all clients.

  The `HTTP_API_PORT` option is now more aptly named since Electric exposes more than just the status endpoint
  on that port.

## 0.5.0-next.4

### Patch Changes

- f8cf910: Remove SchemaRegistry and use our cached knowledge of the pg schema to fulfill all requirements for knowledge of the replicated tables

## 0.5.0-next.3

### Patch Changes

- e4cbf80: Update Elixir to 1.15.4 to fix remote shell

## 0.5.0-next.2

### Patch Changes

- 089968d: Fixed the issue whereby calling electrify() on a previously electrified table caused a duplicate migration to be created and put onto the replication stream.
- 8b8cc93: Fix a bug in schema version validation
- e17b37e: Fix the bug where the client failed to restart the replication connection after completing the initial sync once.
- 2e8bfdf: Fixed the client not being able to reconnect if the migrations were preloaded and the only operation was a subscription. In that case the client have never received any LSNs (because migrations didn't need to be sent), so reconnection yielded errors due to missing LSN but existing previously fulfilled subscriptions. We now send the LSN with the subscription data so even if it's the first and only received message, the client has enough information to proceed.
- 3ca4917: Fixed an issue where sometimes subscription data would not be sent in absence of other writes to PG

## 0.5.0-next.1

### Patch Changes

- 6026ced: Update all deps that had new backwards-compatible versions

## 0.5.0-next.0

### Minor Changes

- 69d13c4: Rewritten the Electric sync layer to remove Vaxine and enable partial replication

  This release encompasses quite a bit of work, which resulted in a complete overhaul of the current system. It's hard to note all changes, see git history for that, but this public release
  marks the first somewhat stable version of the system for which we intend incremental changes.

  That said, this is still considered an unstable release and so this is only a minor version bump.
  We intend to keep this and the `electric-sql` typescript library somewhat in sync on minor versions up to `1.0.0`: new features that require both server-side support as well as client-side support are going to result in a minor-level version bump on both, while features/improvements that don't need both sides will be marked as a patch version.

  Rough change list between previous version and this one:

  - Removed Antidote (Vaxine) from the system
  - Moved CRDT conflict resolution into GitHub using special observed operations CRDT form
  - Streamlined the deployment heavily by relying now on unpatched Postgres
  - Removed the Postgres-to-Postgres replication
  - Added the concept of "electrified" tables - only those can be synced to the client
  - Added PG-managed migrations instead of relying on an external system (previously, our cloud console) to manage them
  - Added migration propagation to the client so that the server may dictate table creation to the clients
  - Heavily improved initial sync story: we don't send the entire Antidote write-ahead log on connect, we send actual data queried from Postgres and then start streaming the changes
  - Added the first iteration of partial replication, where the client subscribes to tables they are interested in instead of the all available tables
