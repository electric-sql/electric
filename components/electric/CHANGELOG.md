# @core/electric

## 0.10.2

### Patch Changes

- 450a65b3: Support for a local Postgres database on the client. Also introduces drivers for node Postgres and PGlite.
- bbe2f243: Persist client reconnection info to the database. This allows the sync service to restore its caches after a restart to be able to resume client replication streams and avoid resetting their local databases.
- f3096b10: Switch the default value of `DATABASE_USE_IPV6` to "false".
- d3759838: fix: filter the compensations along with main changes using the magic `electric_user_id`
- 6573147a: fix: non-leading primary key columns should no longer break replication
- cb175558: Introduce the concept of "WAL window" that Electric can keep around to enable it to recover already-seen transactions after a restart.

  Where previously Electric was acknowledging transactions as soon as it was
  receiving them from Postgres, now it will manually advance its replication's
  slot starting position when needed to keep the overall disk usage within the
  configurable limit. This allows Electric to replay some transactions it
  previously consumed from the logical replication stream after a restart and
  repopulate its in-memory cache of transactions that it uses to resume clients'
  replication streams.

- ed915ddd: Fix electrification of tables with previously dropped columns.
- 2be5f171: Fix serialization of composite PKs in Electric's internal SQL code.
- f12dd95c: Fix data encoding issues caused by unexpected cluster-wide or database-specific configuration in Postgres. Electric now overrides certain settings it is sensitive to when opening a new connection to the database.
- 69eb03c2: fix: migration statements in a transaction should preserve original order when sent to the clients.
- c00c293b: shapes: support `IS NULL`, `IS NOT NULL`, `IS TRUE/FALSE` and `IS NOT TRUE/FALSE` operators in where clauses
- c8e69814: Revert the change introduced in 0deba4d79de61a31aa19515d055a2a977a8e1b4e (released in version 0.9.3) where the configured signing key would get automatically decoded if it looked like a valid base64-encoded string.

  Electric will no longer try to interpet the signing key. A new configuration option named `AUTH_JWT_KEY_IS_BASE64_ENCODED` has been added.

## 0.10.1

### Patch Changes

- c8eec867: Fix handling NULL values when filtering replication stream

## 0.10.0

### Minor Changes

- 284d987d: Introduce shapes with relation following on server and client

### Patch Changes

- f200734d: Fix the issue where the sync service would not sync any rows that had been present in a table before it was electrified.
- 419e7b28: Fix unbounded disk usage growth caused by the WAL records retained by Electric's replication slot.
- b7e99c88: Added support for BYTEA/BLOB column type across the sync service, TS client, and client generator
- 378b1af1: fix: make sure the client is gracefully disconnected if PG is too slow on connection
- 2394ec93: Include all publishable tables in the publication that Electric creates at startup.

## 0.9.4

### Patch Changes

- 452361d5: Limit client connections when the sync service's Postgres connection is down.
- 209192a3: [VAX-1664] Fix for prisma database introspection
- 90735031: Create a publication in Postgres on startup. This would restore the replication stream from Postgres to Electric if the publication got deleted by accident.

## 0.9.3

### Patch Changes

- 11069a90: Handle JWT expiration on the TS client, and support reconnecting after JWT expires.
- 8f9bcb53: Deduplicate enum type definitions in the electrified schema.
- 65aaeee5: Electric will now fail to start when a secure auth setting is used with AUTH_MODE=insecure.
- 21a3a8c4: Pass the SSL options used for the main database connection to upstream connections established by the migrations proxy.
- 0deba4d7: Validate public signing keys at startup. This allows for catching invalid key configuration early as opposed to getting an "invalid token signature" error when a client tries to authenticate.
- b320bc16: Changed how the DDL statements for electrified enum columns are stored internally. This change requires resetting the database if it has at least one electrified enum column.
- 0deba4d7: Accept base64-encoded symmetric signing keys. Electric will detect and decode such keys automatically. Binary keys are also accepted as before.
- 9ed7b728: Reject electrification of tables outside of the public schema. This is a documented limitation that is now also enforced in the code.
- c037fdd9: Enable SSL certificate validation for database connections when DATABASE_REQUIRE_SSL=true.

## 0.9.2

### Patch Changes

- 3a78a767: Removes unnecessary comma in conflict resolution PG trigger shadow table update query
- 6fc36865: Upgrade the build environment to use Erlang (25.3.2.8) and Elixir (1.16.1).
- 6fc36865: Include the Server Name Indication (SNI) SSL option when connecting to the database. This makes it possible for Electric to connect to Neon (neon.tech).
- 210b9e36: Support JWTs without a trailing dot in the Insecure auth mode. (#900)

## 0.9.1

### Patch Changes

- 30179e87: [VAX-1553] Add support for AuthenticationMD5Password upstream auth method in the Migrations proxy. This fixes a connectivity issue between Electric and DigitalOcean Managed PostgreSQL.
- dd27d6a1: [VAX-1543] Add support for the sslmode query option in DATABASE_URL.

## 0.9.0

### Minor Changes

- df56221b: Reject electrification of tables that have no PRIMARY KEY or include unsupported constraints. Only PRIMARY KEY and FOREIGN KEY constraints are currently supported.
- 3a7fb38b: Validate table column types and constraints for new columns that are added to electrified tables with ALTER TABLE ... ADD COLUMN.
- afa4f839: Reject ALTER TABLE ... ADD COLUMN statements that try to add a new foreign key to an already electrified table.

### Patch Changes

- 07499d3e: Format some known errors in an easy-to-read way, including more context and information about resolution in the error messages.
- 4fe5c7f6: [VAX-1040] [VAX-1041] [VAX-1042] Add support for user-defined enum types in electrified tables.
- 2ac82759: Validate config values and print all missing or invalid config options at Electirc startup.
- d386fd98: Try connecting to the database over IPv6 and IPv4, in that order, and use the first option that works. This obviates the need for the DATABASE_USE_IPV6 configuration setting in most cases.
- e8bb9a8f: Enforce the use of SSL for database connections by default.
- 82202278: [VAX-1449] Add the notion of "clock drift" to Electric and use it when validating timestamps in auth tokens. Among other things, this fixes the issue where an auth token is used to authenticate with Electric before even a second passes after it was generated.
- 743c5d07: Configure the sync service using dev.env and test.env files in development and testing.

## 0.8.1

### Patch Changes

- 0dfb35d8: [VAX-1324] Prevent updates to table PKs
- a3d4bfe2: Electric now opens all its ports to listen both on IPv4- and IPv6-capable interfaces. This obviates the need for the ELECTRIC_USE_IPV6 configuration setting in most cases.
- 34a89b4a: Automatically publish electricsql/electric:canary images to Docker Hub on every push to main.
- b57ec927: [VAX-1417] Add the option to tunnel TCP connections to the migrations proxy over regular WebSocket connections.
- 34a89b4a: Log the version of the Electric sync service on startup.
- 11878e74: Log a descriptive error message when Electric fails to open a replication connection to Postgres.
- ddb70c97: [VAX-1374] Add a new write-to-pg mode that applies client updates as DML statements as opposed to streaming them to Postgres over a logical replication connection.

## 0.8.0

### Minor Changes

- eb722c9b: [VAX-1335] Create new protocol op to represent a compensation

### Patch Changes

- 0dc61662: [VAX-820, VAX-1325] Add support for the BIGINT / INT8 column type in electrified tables.
- d9efe923: [VAX-1264, VAX-1265] Fix some edge cases in the parsing of DATABASE_URL.
- 4ad7df4d: [VAX-825] Add support for the JSONB column type in electrified tables.
- b6e589d3: [VAX-846, VAX-849] Add support for the REAL / FLOAT4 column type in electrified tables.
- 96e75630: Swap to using `sub` claim in jwt, backwards compatible with `user_id`.

## 0.7.1

### Patch Changes

- d5a6eb3d: [VAX-1333] Fix introspection of tables with > 1 fk
- a7007589: [VAX-1319] Fix CaseClauseError in Proxy.Prisma.parse_bind_array()
- 1aa98bfe: [VAX-1321] Proxy crashes when GSSAPI session encryption is requested

## 0.7.0

### Minor Changes

- d109a1e7: Major new release that introduces Electric Postgres Proxy, affecting all Electric components.

### Patch Changes

- ede28076: [VAX-1190] Electric crashes on too-big migrations
- 37f3ee4c: Add ELECTRIC_USE_IPV6 configuration option to enable listening on IPv6 interfaces. Add DATABASE_USE_IPV6 configuration option to support connections to Postgres over IPv6.
- 0ef13aa8: [VAX-907] Add a proxy for migration introspection and capture
- cc35c12d: [VAX-1245] New extension migrations fail to apply on top of Electric v0.6.4 schema
- 00eb469d: Adds client-side support for float8 data type.
- ff27bc7d: [VAX-1172] Re-write DDLX parsing for improved compatibility and resiliency
- 2a480884: [VAX-1195] Allow for user-set migration version to override automatically assigned version
- 4092a9d3: [VAX-1212] add feature flag to temporarily disable DDLX commands
- aa7c2650: Reject tables that have columns with DEFAULT expressions.

## 0.6.4

### Patch Changes

- f045ec8: [VAX-1062] Fix column name quoting in a trigger function.

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
