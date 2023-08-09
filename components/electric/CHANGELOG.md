# @core/electric

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
