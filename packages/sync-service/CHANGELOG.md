# @core/sync-service

## 1.0.23

### Patch Changes

- a796d27: Ensure `LockConnection` can be restarted on connection manager restart

## 1.0.22

### Patch Changes

- f15a10c: Do not fire stack events for pool connection errors as they are not actionable.
- c9ad50d: Fix a bug in decoding TRUNCATE messages from the logical replication stream.
- b528bb4: Fix parsing and execution for some edge cases of where clause operators.
- a6c19df: Recognize additional common connection errors and handle appropriately.

## 1.0.21

### Patch Changes

- 50f3ddc: Add env vars to configure telemetry: ELECTRIC_TELEMETRY_LONG_GC_THRESHOLD, ELECTRIC_TELEMETRY_LONG_SCHEDULE_THRESHOLD, ELECTRIC_TELEMETRY_LONG_MESSAGE_QUEUE_ENABLE_THRESHOLD and ELECTRIC_TELEMETRY_LONG_MESSAGE_QUEUE_DISABLE_THRESHOLD
- b5a1f99: Improve replication processing performance by replacing pub/sub mechanism
- 4a6e5b1: Observe errors hit by connections in the DB pool and turn them into stack events.
- 970431a: Fix evaluation of OR operator in where clauses with null values - `null OR true` should be `true` and `1 IN (1, NULL)` should be `true`.
- 7267fe3: Fix issue where replication traffic slows down shape restoration
- 8bee487: Add additional replication processing telemetry
- cd31539: Return 503 from API on snapshot timeout or connection error
- d857b48: Fix race between loading shape and listening for updates to it that caused requests to hang for longer than necessary.
- c59000f: Add experimental SSE support.
- 37c5902: feat: allow publication alter debounce to be configurable

## 1.0.20

### Patch Changes

- a148509: Only warn when publication manager exits during shape cleanup
- 7e8c4f4: Retire obsolete stack event 'database_connection_failed' in favour of 'connection_error'
- 68ba7ed: fix: ensure correct shape lookup & comparison

## 1.0.19

### Patch Changes

- 0c6578d: Fix bug in Shape.comparable/1 preventing client shapes matching existing ones loaded from storage

## 1.0.18

### Patch Changes

- 0928065: Make `PublicationManager` calls idempotent based on shape handles to ensure proper cleanups.
- 34c445b: chore: add more logging around publication altering
- ca329d3: Open a replication connection to acquire the exclusive connection lock, fixing the lock semantics for cases where Electric runs with a pooled connection string.
- 3ef7ed3: Consistently send `:ready` stack event after replication client restarts as well.
- b862abc: Fix compilation issue that appeared in Erlang/OTP 28.0.
- 6d733c5: chore: add Erlang GC metrics to Otel export
- fbeb583: Fix shape hash lookup deletion upon removing shape
- 6bc8924: Fix for possible collisions when generating the next interval timestamp for long polling.
- 0928065: Fix race conditions with shape deletion

## 1.0.17

### Patch Changes

- eed575c: Avoid using GenServers for calculating total disk size for telemetry purposes.
- a37f01b: fix: make sure shape hash collisions aren't causing issues
- 5c62f37: Properly handle response stream interruptions with reason `:closed`.

## 1.0.16

### Patch Changes

- 51c91ac: fix: ensure cleanup and persistance of cached relation information is correct

## 1.0.15

### Patch Changes

- 0f4b7e6: Fix the issue with Electric not picking up values defined in environment variables.
- 544a810: fix: add OTEL logging

## 1.0.14

### Patch Changes

- c850bf5: Fix ipv6 to ipv4 fallback in the case of 'host is unreachable'
- b63528d: Fix the issue with failing to report vm memory metrics. Change the name of the "vm.memory.processes_by_type" metric to "process.memory.total".
- fb721d4: Ensure stack is active after long poll timeout
- bbeb474: Run a helper process in background during integration tests to make sure Connection.Manager remains responsive to incoming messages.
- f76a76e: Fix a typo in the 'targets' option for telemetry deps, ensuring they are left out from compilation unless MIX_TARGET=application.
- 0f14663: Remove `location` header from 409 resopnses
- 3eddb51: Drop and recreate the replication slot when the publication goes missing. This will also invalidate existing shapes to ensure consistency. Fixes #609.
- 9a89006: Increase timeout for restored shape subscriptions
- 01b0d4c: Upgrade Elixir deps to the latest available versions.

## 1.0.13

### Patch Changes

- e79ad21: Allow replication connection some time before considering it succeeded so errors can come through.
- b40fb17: Ensure stack messages are JSON serialisable

## 1.0.12

### Patch Changes

- 8c52956: Fix: properly handle more connection-related edge cases. Streamline error reporting in stack events.
- 7f01303: Lower severity of expected lock acquisition errors
- 4ad1d0f: Mitigate `EEXIST` error on `rm_rf` due to suspected filesystem race with retries.
- c66b869: Use non-pooled connection for grabbing advisory lock to avoid unexpected behaviour.
- a00e863: fix: ensure continued replication (via shape reset) when WAL slot size is exceeded
- 55aef88: Fix handling of some connections errors. Treat "wal_level != logical" as a fatal error after which there's no point in retrying the connection.
- c82153d: fix: make sure a split PK update is visible in the read log when it's in the last position in the transaction
- 575a6fa: fix: load instance_id from opts for configuring application_telemetry
- 79d769a: Electric will now shut down and provide an error message if there is a critical error connecting to the database
  such as the database or domain not existing.

  The API will now return more helpful error messages if Electric is having issues connecting to the database.

- c7bde30: Add stack events for when timeline change is detected and when the database connection shuts down.
- 7fa69ac: fix: don't send a 500 on a shape delete race condition

## 1.0.11

### Patch Changes

- c9bcd6b: Fix the 5-second delay at Electric's first launch caused by incorrect installation ID detection logic.
- bbad9df: fix: check for table identities in one query instead of N when altering the publication
- bb4a439: fix: make sure Electric restart doesn't cause requests with `0_inf` to fail

## 1.0.10

### Patch Changes

- 0646255: Make Electric disable SSL when it fails to connect to Fly Postgres using SSL.
- d946dd1: fix: make sure wal size reporting can't block anything
- db9bfec: fix: shape cleanup should delete the shape handle too

## 1.0.9

### Patch Changes

- 1441896: feat: add random slot name generation when using temporary slots

## 1.0.8

### Patch Changes

- 056b1d4: fix: add a more explicit error handling in case periodic metric collection fails and make wal queries async

## 1.0.7

### Patch Changes

- 03e7f59: Always add invalid etag for empty live requests
- c4ba869: Respond immediately to live requests with a 409 if shape invalidated/rotated
- dc1582a: fix: correctly catch race conditions when the shape has been validated against old schema, but the underlying schema changed before we got to a snapshot query or publicaiton alteration
- bb105ff: Add a process label for LockConnection and fix the process label for ReplicationClient.
- 2dd3165: Clean up old connection holding logic for when the stack is not ready.

## 1.0.6

### Patch Changes

- 5189825: Handle non existant DB as a fatal error.
- 04feeea: Update otel_metric_exporter to fix protobuf encoding error
- cb95ab5: Obfuscate database password during parsing to prevent its accidental leaking in logs.

  When Electric is used in library mode, obfuscation by the parent application is
  optional: Electric doesn't log the connection options until after it has
  obfuscated the password.

- e2a7008: Fix error generated when getting memory stats with dead processes
- 68b0839: Fix a fatal bug in the encoding of WHERE query params when returning a 409 response from the server.
- 787e363: Fix for initialization race condition that resulted in the error "the table identifier does not refer to an existing ETS table"
- 3988f31: Update otel_metric_exporter to v0.3.5 for bugfixes
- b65e70d: Set shape recovery timeout per-shape, not globally
- c63c24b: Fix memory stats collection on dead processes

## 1.0.5

### Patch Changes

- fd11e14: Improve error handling in case of failure to start shapes supervisor.
- dea3e1b: fix: improve error handling in bad PG connectivity

## 1.0.4

### Patch Changes

- d278b9f: fix!: Convert live responses with no changes from `204` to `200`.

  BREAKING CHANGE: community clients relying on `204` alone for up-to-date logic might break - live responses now always return a `200` with a body/

- d2c2342: Improved replication processing telemetry
- 1c729fa: fix: refetch schema from DB when seeing a relation message to get recent info

## 1.0.3

### Patch Changes

- e45d390: fix: disallow generated columns in shapes
- 85b863a: Synchronously recover shapes and publication to ensure Electric boot is successfuly, and clear cache if it fails.
- b8a71cd: Add experimental LRU shape expiry
- a71686e: Never cache `>= 400` response codes, except `409` as effective redirects, and anything other than `GET` and `OPTIONS`.
- 844a54f: fix: skip updates that don't change any columns
- f810e82: Electric now also returns 409 instead of 400 when the shape handle and the shape definition do not match.
- 15e6d1d: Fix backwards compatibility parsing of old shape definitions' flags

## 1.0.2

### Patch Changes

- d222480: Fix where clause inclusion index to support array is null

## 1.0.1

### Patch Changes

- 4c24123: Speed up replication processing by removing file writes from the main processing loop

## 1.0.0

### Minor Changes

- f1a9247: feat!: change the wire protocol to remove `offset` and add an explicit `lsn` header. Only valid offset now is the one provided in headers

### Patch Changes

- 74e54e1: feat: add receive/replication lag to exposed metrics
- 1255205: First beta release
- c4473b0: feat: lower the per-shape memory usage, especially for very large tables
- 8987142: Do not trap exits in `Electric.Shapes.Consumer` - not handled.
- 519fc8a: Separate `ConnectionBackoff` logic for `Connection.Manager` to enhance `:bakckoff` functionality.
- edfb9f3: feat: add compaction flag to Electric that allows `UPDATE` events within a shape to be compacted to save space and bandwidth
- bd2d997: Make configuration easier and more accessible to external applications
- f1a9247: feat: add a special header to last operation in transaction for a given shape
- 9ed2ca3: Ensure request-scoped new changes listener is clenaed up when request ends.
- 84eb729: Fix arithmetic bugs in system memory stat calculations.
- 40dcfe8: Add support for casting enums to text in where clauses (e.g. `type::text = 'foo'`).
- 5516d70: Fallback to IPv4 if `DATABASE_USE_IPV6` is enabled but an IPv6 address could not be resolved.
- 9401491: Return chunked repsonses to live requesters if new changes large enough.
- bbcc719: Drop transactions that have already been processed rather than reapplying them.
- 0d71dc4: fix: don't expose information about columns that weren't selected
- ccafe48: fix: Fix file corruption when concatenating files during compaction
- b84cd5c: Expose globally last-seen LSN on up-to-date messages
- f6a3265: Carry over full original shape query in 409 redirects.
- 5da8f25: Only include telemetry in docker build
- eb8167a: Implement `ELECTRIC_QUERY_DATABASE_URL` optional env var to perform queries with separate, potentially pooled connection string.
- 3867309: Fix the startup failure problem caused by broken release packaging.
- 49dd88f: fix: Fix file corruption when doing external sort during compaction
- 3eb347b: Add optional telemetry to profile where clause filtering
- 218b7d4: fix: truncates no longer cause a stop to an incoming replication stream
- dcd8a9f: feat: add `old_value` to updates under replica mode `full`
- 7cb4ccb: Electric as a library: Support multiple stacks
- 309ac75: Do not await full setup for configuring replication slot drop.
- eccdf9f: - Do not await for responses while recovering publication filters.
  - Remove publication update debounce time - simply wait until end of current process message queue.
- 2dd8ca0: Reset reconnection attempt backoff timer and add more information to connection failure events.
- c649f8b: Electric now runs in Secure mode by default, requiring an `ELECTRIC_SECRET` to be set.

  BREAKING CHANGE: Electric now needs to be started with an `ELECTRIC_SECRET` environment variable unless `ELECTRIC_INSECURE=true` is set.

- f92d4b3: Fallback to replicating whole relations if publication row filtering cannot support given where clauses.
- b48973b: Fix incorrect LSN comparisons leading to dropped transactions.
- 54fb0ac: Avoid stopping the beam process when an unrecoverable error is encountered. Instead, stop the main OTP supervisor. Required for multi-tenancy.
- 7caccbf: Return `202` for `waiting` and `starting` health status - accepts requests but will fail to service them.
- c444072: Allow multiple conditions in a where clause to be optimised (not just one)
- 7600746: Add option to send memory metrics per process type
- 5f2cb99: fix: ensure correct JSON formating when reading concurrently written snapshot
- 2f5b7d4: fix: ensure smooth upgrade for filesystem KV format change
- 6ca47df: feat: introduce chunked snapshot generation
- 329c428: Electric as a library: Telemetry config is now option parameters rather than application environemnt config
- 2f6452c: Change stack_id to source_id in open telemetry export
- 7f36cc1: Use `Storage.unsafe_cleanup!/1` to delete data after a shape has been removed
- 0a95da1: Allow for accessing via an api that serves only a pre-configured shape, move all http logic into api
- d22e363: Fix transaction ID comparison logic to use correct modulo-2^32 arithmetic.
- 46a0d4e: fix: fixes file merging during compaction, which was very suboptimal due to a bug
- f1a9247: feat: replace `txid` with `txids` header
- 802680f: feat: make sure lines that underwent compaction don't reference any transaction id
- ac9af08: Add configuration flag to disable HTTP cache headers
- c4e4e75: Connect shape consumer spans to replication traces and add OTEL metrics
- 108144e: fix: allow `traceparent` headers for OTel
- e29724e: Fix bug with WHERE clauses with logical operators (AND, OR, etc.) with 3 or more conditions chained together
- 8955a58: Refactor to use an internal api to provide the shape change stream
- 07a767f: Add telemetry to time various parts of the WAL processing
- 8ce1353: Add embedded mode to Elixir client using the new Shapes API
- 9554498: Improve public APIs of Elixir client and core electric
- 214435b: System metrics will now be sent to Honeycomb as well as traces
- 4d7b8ba: Add support for shapes on partitioned tables
- 78fdc21: Fix: Setting ELECTRIC_STORAGE_DIR wasn't changing where Electric was storing shape logs and its persistent state due to a bug.
- 7c72c1e: Reduce memory footprint by hibernating idle shapes
- 126317f: fix: ensure we correctly set globally processed lsn
- 7496f9a: Fix race that caused the same `global_last_seen_lsn` to appear on two subsequent, but different, up-to-date responses by determining it at the start of the request processing pipeline.
- c444072: Optimise where clauses that have a condition in the form 'array_field @> array_const'
- 059a69a: Improve quoting logic in relation_to_sql/1 to handle reserved words and tables starting with a number
- f8a94aa: chore: ensure proper trace span connection for snapshot creation
- c2b01c1: Encode LSN as string in JSON responses for correct handling of large values (>53 bits) in Javascript.
- 8a4b0d5: Ensure shape properties are added to OTEL spans in shape requests.
- 214435b: Add metric publishing to Honeycomb when that exporter is enabled
- d7e7c72: Introduced `PublicationManager` process to create and clean up publication filters.

## 1.0.0-beta.23

### Patch Changes

- 9401491: Return chunked repsonses to live requesters if new changes large enough.
- b48973b: Fix incorrect LSN comparisons leading to dropped transactions.

## 1.0.0-beta.22

### Patch Changes

- 9ed2ca3: Ensure request-scoped new changes listener is clenaed up when request ends.

## 1.0.0-beta.21

### Patch Changes

- f6a3265: Carry over full original shape query in 409 redirects.
- 108144e: fix: allow `traceparent` headers for OTel
- 07a767f: Add telemetry to time various parts of the WAL processing

## 1.0.0-beta.20

### Patch Changes

- 74e54e1: feat: add receive/replication lag to exposed metrics
- bd2d997: Make configuration easier and more accessible to external applications
- bbcc719: Drop transactions that have already been processed rather than reapplying them.
- 5da8f25: Only include telemetry in docker build
- dcd8a9f: feat: add `old_value` to updates under replica mode `full`
- 7600746: Add option to send memory metrics per process type
- 2f5b7d4: fix: ensure smooth upgrade for filesystem KV format change
- 0a95da1: Allow for accessing via an api that serves only a pre-configured shape, move all http logic into api
- 9554498: Improve public APIs of Elixir client and core electric
- 126317f: fix: ensure we correctly set globally processed lsn
- 059a69a: Improve quoting logic in relation_to_sql/1 to handle reserved words and tables starting with a number

## 1.0.0-beta.19

### Patch Changes

- 49dd88f: fix: Fix file corruption when doing external sort during compaction
- f92d4b3: Fallback to replicating whole relations if publication row filtering cannot support given where clauses.
- c444072: Allow multiple conditions in a where clause to be optimised (not just one)
- d22e363: Fix transaction ID comparison logic to use correct modulo-2^32 arithmetic.
- c444072: Optimise where clauses that have a condition in the form 'array_field @> array_const'
- 8a4b0d5: Ensure shape properties are added to OTEL spans in shape requests.

## 1.0.0-beta.18

### Patch Changes

- 2f6452c: Change stack_id to source_id in open telemetry export

## 1.0.0-beta.17

### Patch Changes

- 329c428: Electric as a library: Telemetry config is now option parameters rather than application environemnt config
- 8ce1353: Add embedded mode to Elixir client using the new Shapes API

## 1.0.0-beta.16

### Patch Changes

- 7cb4ccb: Electric as a library: Support multiple stacks

## 1.0.0-beta.15

### Patch Changes

- 3eb347b: Add optional telemetry to profile where clause filtering

## 1.0.0-beta.14

### Patch Changes

- 3867309: Fix the startup failure problem caused by broken release packaging.

## 1.0.0-beta.13

### Patch Changes

- 54fb0ac: Avoid stopping the beam process when an unrecoverable error is encountered. Instead, stop the main OTP supervisor. Required for multi-tenancy.

## 1.0.0-beta.12

### Patch Changes

- 519fc8a: Separate `ConnectionBackoff` logic for `Connection.Manager` to enhance `:bakckoff` functionality.
- 40dcfe8: Add support for casting enums to text in where clauses (e.g. `type::text = 'foo'`).
- b84cd5c: Expose globally last-seen LSN on up-to-date messages
- 2dd8ca0: Reset reconnection attempt backoff timer and add more information to connection failure events.
- 8955a58: Refactor to use an internal api to provide the shape change stream

## 1.0.0-beta.11

### Minor Changes

- f1a9247: feat!: change the wire protocol to remove `offset` and add an explicit `lsn` header. Only valid offset now is the one provided in headers

### Patch Changes

- f1a9247: feat: add a special header to last operation in transaction for a given shape
- f1a9247: feat: replace `txid` with `txids` header

## 1.0.0-beta.10

### Patch Changes

- 5516d70: Fallback to IPv4 if `DATABASE_USE_IPV6` is enabled but an IPv6 address could not be resolved.
- 0d71dc4: fix: don't expose information about columns that weren't selected
- c4e4e75: Connect shape consumer spans to replication traces and add OTEL metrics
- f8a94aa: chore: ensure proper trace span connection for snapshot creation

## 1.0.0-beta.9

### Patch Changes

- 802680f: feat: make sure lines that underwent compaction don't reference any transaction id

## 1.0.0-beta.8

### Patch Changes

- edfb9f3: feat: add compaction flag to Electric that allows `UPDATE` events within a shape to be compacted to save space and bandwidth
- 7f36cc1: Use `Storage.unsafe_cleanup!/1` to delete data after a shape has been removed

## 1.0.0-beta.7

### Patch Changes

- eccdf9f: - Do not await for responses while recovering publication filters.
  - Remove publication update debounce time - simply wait until end of current process message queue.
- 5f2cb99: fix: ensure correct JSON formating when reading concurrently written snapshot

## 1.0.0-beta.6

### Patch Changes

- 214435b: System metrics will now be sent to Honeycomb as well as traces
- 214435b: Add metric publishing to Honeycomb when that exporter is enabled

## 1.0.0-beta.5

### Patch Changes

- 4d7b8ba: Add support for shapes on partitioned tables
- 7c72c1e: Reduce memory footprint by hibernating idle shapes

## 1.0.0-beta.4

### Patch Changes

- e29724e: Fix bug with WHERE clauses with logical operators (AND, OR, etc.) with 3 or more conditions chained together

## 1.0.0-beta.3

### Patch Changes

- 84eb729: Fix arithmetic bugs in system memory stat calculations.

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
