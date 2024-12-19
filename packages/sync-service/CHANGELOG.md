# @core/sync-service

## 1.0.0-beta.2

### Patch Changes

- 8987142: Do not trap exits in `Electric.Shapes.Consumer` - not handled.
- 218b7d4: fix: truncates no longer cause a stop to an incoming replication stream
- 7caccbf: Return `202` for `waiting` and `starting` health status - accepts requests but will fail to service them.
- d7e7c72: Introduced `PublicationManager` process to create and clean up publication filters.

## 1.0.0-beta.1

### Patch Changes

- 1255205: First beta release
- 309ac75: Do not await full setup for configuring replication slot drop.
- 6ca47df: feat: introduce chunked snapshot generation

## 0.9.5

### Patch Changes

- 95b61e7: Configure sentry for error tracking.

## 0.9.4

### Patch Changes

- 3584f67: Validate that user provided offset is not bigger than the shape's latest offset.
- 0dc844f: Remove redundant spans in open telemetry tracing.
- a16ab24: feat: add more telemetry
- 3c24208: Clean up directories when removing shapes.
  Remove corrupted shapes from store when recovery fails.
- 4e50204: Telemetry for reporting replication lag.
- 704ac91: Include caching headers on 304 responses to prevent client from rechecking the previously cached ones over and over again.
- ceec2d4: Assume process is not alive if registry is not alive.
- 37b4256: Improved replication steam processing for where clauses in the form `field = const` or `field = const AND another_condition`
- 64fe275: Restore the automatic fallback to unencrypted database connections when SSL isn't available.
- 5b1c3e6: Resolve naming confusion between `ELECTRIC_LOG_CHUNK_BYTES_THRESHOLD` and logging-related configuration options. Add `ELECTRIC_` prefix to `LOG_LEVEL` to `LOG_OTP_REPORTS` config options. Introduce a new config option named `ELECTRIC_LOG_COLORS`.
- e815b91: Log error but don't fall over if failing to initialise recovered shape

## 0.9.3

### Patch Changes

- 72c7c46: fix: don't execute `ALTER TABLE` statements if not necessary

## 0.9.2

### Patch Changes

- 6a88009: fix: correctly scope the storage based on the tenant and use already-provided tenant id

## 0.9.1

### Patch Changes

- 090fab5: Fix source links in Hexdocs
- 598aa28: Improve reliability: Shapes that error while processing the replication stream will now be removed leaving other shapes unaffected
- 584c4f5: use traceparent header from incoming shape requests to set parent span
- c5b79a5: Add global stack events registry for receiving updates on the stack status

## 0.9.0

### Minor Changes

- 1497be2: Split out multitenancy and allow Electric to function as a library

## 0.8.2

### Patch Changes

- d98d9ed: Fix root table parameter validation to return 400 when missing
- 90ead4f: Support for managing multiple databases on one Electric (multi tenancy).
- 5e60e71: Refactored the tenant manager to store tenant information in an ETS table for improved read performance.
- ae18f4a: Drops the replication slot when `DELETE /v1/admin/database/:database_id` is called

## 0.8.1

### Patch Changes

- b367c8d: Make the client table option _not_ required as a team using a proxy API might set the table there.

## 0.8.0

### Minor Changes

- 4d872b6: [breaking] Changes the API contract for the server to use new, clearer header names and query parameter names. One highlight is the change from `shape_id` to `handle` as the URL query parameter
- 4d872b6: [BREAKING] All shape API endpoints now accept `table` as a query parameter rather than a path parameter, so `/v1/shape/foo?offset=-1` now becomes `/v1/shape?table=foo&offset=-1`.

### Patch Changes

- 1cf8bf9: Fix `ELECTRIC_REPLICATION_STREAM_ID` not being able to be set because of incorrect parsing
- 16698ff: Add tracing of snapshot creation and more logging of postgres connection status. Prevent connection timeouts when writing snapshot data. Add `ELECTRIC_LOG_OTP_REPORTS` environment variable to enable OTP SASL reporting at runtime.
- c4d118d: Add `CLEANUP_REPLICATION_SLOTS_ON_SHUTDOWN` env var option to configure whether temporary replication slots are used, to allow easier cleanups on test deploys
- b110ed9: Update acknowledged WAL on keep alive messages
- 0873da2: Consistently prefix environment variables with our ELECTRIC\_ namespace
- 52caf48: Update OpenTelemetry dependencies
- aed079f: Add `replica` parameter to change the behaviour for updates to include the full row, not just the modified columns
- 85618d0: Fix a possible deadlock issue when creating or updating multiple where-claused shapes that occured while updating the Postgres publication (only on PG 15+). Fix a possible race condition between reading the existing publication and writing the updated version.

## 0.7.7

### Patch Changes

- 11c326f: Unify CORS header handling to ensure they are always present
- 7de9f1d: Handle 400 errors as unrecoverable rather than `must-refetch` cases
- 3bdf6b6: Handle relations in `ShapeLogCollector` same way that transactions are handled
- a8b36ac: Validate table names locally first before going to PG to save resources

## 0.7.6

### Patch Changes

- 9860f5c: Increase max-age for the initial -1 offset request to 1 week (from 60 seconds) so browsers/CDNs keep the initial segment of the shape log in their cache
- 7f86b47: Fix in-memory storage chunking boundaries recovery to actually respect stored boundaries
- bdbfd46: Parse and validate `REPLICATION_STREAM_ID` as it cannot include special characters

## 0.7.5

### Patch Changes

- a1d332f: fix: make sure array column types are correctly passed around & that array comparison functions work on nested arrays

## 0.7.4

### Patch Changes

- b093b79: Reduce the default `DB_POOL_SIZE` to `20`.
- 3ab27a6: Implement support for array columns and operations over those in where clauses

## 0.7.3

### Patch Changes

- b9db6ca: Add LOG_LEVEL configuration option.
- 25c437f: Implement `columns` query parameter for `GET v1/shapes` API to allow filtering rows for a subset of table columns.
- 2bf933c: Obfuscate database password in the process memory to prevent it from accidentally getting logged in cleartext.

## 0.7.2

### Patch Changes

- 8ad40e7: Make relation OID part of shape definition, removing the need for persisting relations and simplifying relation change handling.
- 41845cb: Fix inconsistencies in http proxies for caching live long-polling requests.

  The server now returns a cursor for the client to use in requests to cache-bust any stale caches.

- 14681cc: Store shape definitions along with shape data and use that to restore them instead of persisted cached metadata. This removes the unified serilization and persistence of all shape metadata and allows better scaling of speed of shape creation.

## 0.7.1

### Patch Changes

- e499c05: Add the OTEL_DEBUG environment variable which is a flag to print Open Telemetry spans to stdout.

## 0.7.0

### Minor Changes

- 9ed9511: Lets Postgres validate user-provided table identifier.
  This means identifiers are now case insensitive unless you explitictly quote them.

## 0.6.3

### Patch Changes

- c886f86: Query Postgres server version as early as possible so that it is available throughout the whole connection initialization process.
- 841922d: Cover the processing of GET /shape with OpenTelemetry spans for improved observability.

## 0.6.2

### Patch Changes

- 5f6d202: - Wait for advisory lock on replication slot to enable rolling deploys.
  - Configurable replication slot and publication name using `REPLICATION_STREAM_ID` environment variable.
  - Add `HealthCheckPlug` API endopint at `v1/health` that returns `waiting`, `starting`,and `active` statuses.

## 0.6.1

### Patch Changes

- 8d886ba: Add LISTEN_ON_IPV6=true|false configuration option to support IPv6 network interfaces.

## 0.6.0

### Minor Changes

- b0d258d: Rename Electric's custom HTTP headers to remove the x- prefix.

### Patch Changes

- e459a62: Add `electric-chunk-up-to-date` header to up-to-date responses for optimizing caching and prefetching.

## 0.5.2

### Patch Changes

- 5e72067: Fix the configuration of OpenTelemetry libraries, removing the "inets_not_started" warning from log output.
- e7fdb14: Fix how Electric reads PG's version number.
- df3c174: Don't crash when there are no active shapes
- fa879b1: Don't timeout when writing to lots of shapes

## 0.5.1

### Patch Changes

- 0b8fbc4: Run filter logic for PG version 15 in unit tests.
- aaf9c75: Clean up underlying shape data when cleaning up shape.

## 0.5.0

### Minor Changes

- c842835: Detect when Electric is connected to a different Postgres DB than before and clean all shapes.

### Patch Changes

- fd6b88f: Change default chunk size to ~10MB uncompressed.
- 66ee2ae: Add OpenTelemetry spans for HTTP request handling and replication message processing.

## 0.4.4

### Patch Changes

- e3a07b7: Return 400 if shape handle does not match shape definition. Also handle 400 status codes on the client.
- 5c684bd: Add shape filters to Postgres publication to reduce processing load on Electric.

## 0.4.3

### Patch Changes

- ce0df75: Fix initial snapshot race condition

## 0.4.2

### Patch Changes

- c60cadb: Handle Postgres Point In Time Recoveries (PITR) by cleaning all shapes.
- a95a269: Support OPTIONS request required for preflight requests.
- 6703657: feat: add cache max-age of 5 seconds to ?live requests so request collapsing works
- 6895352: Support HTTP HEAD requests.

## 0.4.1

### Patch Changes

- 18b7054: Improve consistency of shape consumers after storage error

## 0.4.0

### Minor Changes

- b3f5d7c: Introduce and enable by default a new iteration of the storage engine, which is more optimal when creating new shapes. If you need to continue using the old shapes without interruption, set `STORAGE=cubdb` environment variable.
- 1461432: Replace individual persistence location configuration with a single `STORAGE_DIR` environment variable, that should be bound to a volume to survive Electric restarts. If you were using `CUBDB_FILE_PATH`, you should move that folder into a subdirectory named `shapes` and configure `STORAGE_DIR` to the previous directory.

### Patch Changes

- 61cd2a1: Raise the Erlang open port limit to allow for more simoultaneus connecitons
- 6e268cb: Move row-to-JSON serialization for initial shape data from Electric to PG
- b322b95: Added a note to reconnection logging whether the replication mode or regular mode connection is failing

## 0.3.7

### Patch Changes

- 67b0a5e: Remove timeout when quering to create the initial log to support tables over 150MB in size
- 2b2c2fe: Support BETWEEN, BETWEEN SYMMETRIC and IS UNKNOWN comparison predicates
- 77d7bff: Implement log chunking, which tries to keep chunks within the specified `LOG_CHUNK_BYTES_THREHSOLD` - see [relevant PR](https://github.com/electric-sql/electric/pull/1606)
- 538d99f: Remove list_active_shapes and replace it by list_shapes.
- 1d00501: Clean cached column info on relation changes.

## 0.3.6

### Patch Changes

- e5a1d8e: Fix a crash caused by incorrect conversion of an UPDATE into an INSERT or a DELETE depending on whether it is a shape move-in or a shape move-out case.
- 9faab42: Move to process- and storage-per-shape

## 0.3.5

### Patch Changes

- 5f31867: Don't search for exact log entry with provided offset. Fixes a bug that caused an infinite loop of initial syncs followed by 409s.

## 0.3.4

### Patch Changes

- fa88719: clean shapes affected by migrations
- e3b0040: Fix a bug in ReplicationClient caused by an invalid assumption about cross-transaction operation LSN ordering.

## 0.3.3

### Patch Changes

- 11f564d: Support quoted schema and table names

## 0.3.2

### Patch Changes

- 1803392: Support larger shapes (1 million row, 170MB +) and faster time to first byte
- 09f8636: Include nullability information in schema. Also parse null values in the JS client.

## 0.3.1

### Patch Changes

- cb153b4: feat: make DB pool size configurable via `DB_POOL_SIZE` environment variable & raise the default to 50

## 0.3.0

### Minor Changes

- 8e584a1: Fix: rename "action" header -> "operation" to match Postgres's name for inserts, updates, deletes

## 0.2.8

### Patch Changes

- b629d22: First publish to Docker Hub.

## 0.2.7

### Patch Changes

- d24993b: Fix error that occurs when a `/shape` response stream is closed before it is complete,
  for example when `curl --head` is used to call the endpoint.

## 0.2.6

### Patch Changes

- f809c8d: JSON encoding on write rather than read to reduce memory footprint. For example the memory use of an initial sync of a 35MB/200k row table has been reduced from 50MB to 25MB on the first initial sync (which includes the encoding and the writing to storage) and to 6MB on subsequent initial syncs (where we just read from storage and there's no encoding).

## 0.2.5

### Patch Changes

- 10585f4: Add type modifier information in the schema for types that are not built-in.
- 5522305: Enforce the use of consistent display formats for both the initial snapshot and the live replication stream.
- e9a05f8: Use a persistent replication slot to maintain replication connection state between Electric/Postgres restarts.

## 0.2.4

### Patch Changes

- bd0aaed: Configure logical replication stream with display settings.
- 437bc42: Support connecting to the database using SSL by include an appropriate sslmode parameter in the DATABASE_URL setting.
- 06e843c: Only include schema in header of responses to non-live requests.
- c201e88: Only include dims for array types in schema information in HTTP response headers.
- d5c268d: Reduce memory footprint of initial sync by streaming data from storage, for example a 35MB / 200k row table did require 550MB but now requires 50MB
- 358e0ab: Add PK index of column is part of the PK in the column information that is part of the schema information returned in the x-electric-schema
  HTTP header.
- 8e4e57c: Support connecting to the database over IPv6 by configuring the sync service with DATABASE_USE_IPV6=true.

## 0.2.3

### Patch Changes

- bcef81c: Handle database connection failures gracefully and implement reconnection logic with exponential backoff.

## 0.2.2

### Patch Changes

- 9205315: Fix issue that would return a 500 for one of the requests when there are two concurrent requests for the same shape that is not already in cache

## 0.2.1

### Patch Changes

- 72ba8cc: fix: restructure generated keys to avoid possible colisions on multi-pk tables
- 715d2cb: Include schema information in HTTP response header.

## 0.2.0

### Minor Changes

- 36b9ab5: Send only changed columns and PKs on updates instead of full rows, and only PKs on deletes. Also tackle a case where we change a PK of a row - this is split into a delete+insert operations that reference each other using header metadata

## 0.1.7

### Patch Changes

- 8afc720: The initial values in the log are now strings to be consistent with the ongoing values
- bbb377e: fix: correctly parse larger set of Postgres intervals with signs
- ffe7ca7: Detoast "unchanged toast" values in logical message decoding.
- 27c998f: Support primary keys (including composite primary keys).

## 0.1.6

### Patch Changes

- b4d8ae3: Speed up shape creation, 50x faster for tables > 30MB

## 0.1.5

### Patch Changes

- 94956f7: Fix bug with LogOffsets being wrongly compared by the guard of get_log_stream.

## 0.1.4

### Patch Changes

- af3452a: Fix empty initial requests leading to infinite loop of empty live requests.
- 6fdb1b2: feat: include ElectricSQL version header

## 0.1.3

### Patch Changes

- eea9a64: chore: reconfigured CI building

## 0.1.2

### Patch Changes

- 7614a6f: chore: correctly pull version from `package.json`

## 0.1.1

### Patch Changes

- 54fa2cf: Initial release
