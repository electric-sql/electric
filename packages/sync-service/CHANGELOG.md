# @core/sync-service

## 1.4.8

### Patch Changes

- 9c4ace0: Fix out-of-bounds request handler to subscribe to shape events before entering the live request wait loop. Without the subscription, non-live requests that hit the out-of-bounds guard would hang for the full timeout duration (long_poll_timeout/2) instead of recovering when the expected offset becomes available.
- 8691a61: Make gathering of SQLite memory usage metrics optional and default to off to prevent instability in some environments
- d14f504: Handle missing memstat SQLite extension gracefully instead of crashing on startup. When the extension is unavailable, memory statistics are simply omitted from the periodic stats collection.
- 1d1f793: Add `electric-has-data` response header to distinguish data-bearing responses from control-only responses (e.g. long-poll timeouts, `offset=now` requests).

## 1.4.7

### Patch Changes

- ae593c6: Add lock_breaker_guard to optionally disable the lock breaker behaviour
- c293009: Clean up orphaned shape data when encountering an empty shape db
- 02cd199: Add exclusive mode with a single read-write sqlite connection to support AWS EFS
- 9f57a8b: Fix parameter validation rejecting valid sequential params when there are 10 or more of them, due to map keys being iterated in lexicographic rather than numeric order.
- be42de5: Fix storage race condition when deleting shape during a live poll request
- e1028b5: Recover shape db startup when opening a corrupt database file
- 24b0426: Include memory and disk usage statistics from the shape db sqlite instance
- 27fc808: Handle invalid write operations without blocking the write buffer
- 7c2d1fe: Fix an infinite recursive loop that API request processes may get stuck in when the consumer process is slow to start or dies unexpectedly, without cleaning up after itself.
- 8f2f7bd: Handle server clockskew that presents as a -ve replication lag in statistics

## 1.4.6

### Patch Changes

- cc7cfc2: Add disk usage statistics to metrics collection

## 1.4.5

### Patch Changes

- 03943ad: Fix subquery materializer bug where a value toggling across the 0↔1 boundary multiple times in a single batch could lose data by emitting conflicting move_in/move_out events for the same value.

## 1.4.4

### Patch Changes

- 34a240b: fix: metrics from consumer seem to not be emitted because of a struct
- bbfd752: Fixed a bug where rows with subquery-based WHERE clauses could retain stale move tags when the sublink column value changed during a pending move-in, causing the row to not be properly removed on subsequent move-outs.
- dfcfa40: Add disk usage telemetry to stacks.

## 1.4.3

### Patch Changes

- f9b25d6: Fix the issue where transactions that had exactly max_batch_size changes weren't written to the shape log.

## 1.4.2

### Patch Changes

- 2a0902e: Fix race condition crash in DependencyLayers when a dependency shape is removed before its dependent shape is registered.

  When a dependency shape's materializer crashes and is removed while a dependent shape is being added, `DependencyLayers.add_after_dependencies/3` would crash with a `FunctionClauseError` due to a missing clause for exhausted layers with unfound dependencies. This would take down the ShapeLogCollector and cascade into OOM failures.

  `add_dependency/3` now returns `{:ok, layers}` or `{:error, {:missing_dependencies, missing}}`, and the ShapeLogCollector handles the error case gracefully instead of crashing.

- 1c20fac: Fix Materializer startup race condition that caused "Key already exists" crashes

  The Materializer subscribed to the Consumer before reading from storage, creating a window where the same record could be delivered twice (via storage AND via new_changes). Now the Consumer returns its current offset on subscription, and the Materializer reads storage only up to that offset.

- 0b9e38c: Fixed a bug where changes were incorrectly skipped when a record's subquery reference value was in a pending move-in, but the record didn't match other non-subquery conditions in the WHERE clause. For example, with a shape `parent_id IN (SELECT ...) AND status = 'published'`, if the parent became active (triggering a move-in) but the child had `status = 'draft'`, the change would incorrectly be skipped instead of being processed as a delete.
- b134ccb: Fix memory spike during Materializer startup by using lazy stream operations instead of eager Enum functions in `decode_json_stream/1`.

## 1.4.1

### Patch Changes

- b3aa571: Fix missing `electric-offset` header in subset snapshot responses. This header was not being set for subset responses, causing POST subset requests to fail with `MissingHeadersError` in the TypeScript client.

## 1.4.0

### Minor Changes

- 3f257aa: Add POST support for subset snapshots to avoid URL length limits. Clients can now send subset parameters (WHERE clauses, ordering, pagination) in the request body instead of URL query parameters, preventing HTTP 414 errors with complex queries or large IN lists.

## 1.3.4

### Patch Changes

- a1b736f: Fix dependency tracking for nested subqueries when intermediate rows change their linking column without changing the tracked column. Previously, such updates were incorrectly filtered out, causing stale tag tracking that led to incorrect row deletions when the old parent lost its qualifying status.
- dba090e: Fix RelationTracker not syncing with Configurator after restart

  When the RelationTracker restarts while the Configurator is still running, it now properly notifies the Configurator of the restored filters. Previously, after a RelationTracker restart, subsequent shape removals would not update the publication because the internal filter state was inconsistent.

- ba6dd2c: Optimize shape metadata operations by introducing an ETS-based write-through cache with asynchronous SQLite writes

## 1.3.3

### Patch Changes

- b2d28cf: Fix race condition in Materializer startup where the Materializer would crash if the Consumer died during `await_snapshot_start` or `subscribe_materializer` calls. The Materializer now handles GenServer.call exits gracefully and shuts down cleanly.
- edd8fe3: Fix race condition crash in ConsumerRegistry when shape is removed during transaction processing
- d3a79b0: Make rate limit error a known error

## 1.3.2

### Patch Changes

- 8fa682c: Skip hex.pm publish when version already exists to avoid unnecessary CI builds
- c162905: Fix crash when subquery column is NULL

  Fixes a crash (`ArgumentError: not an iodata term`) when using on-demand sync with subqueries (e.g., `task_id IN (SELECT ...)`) and rows have NULL values in the referenced column.

  **Root cause:** In `make_tags`, the SQL expression `md5('...' || col::text)` returns NULL when `col` is NULL (because `|| NULL` = NULL in PostgreSQL). This NULL propagates through all string concatenation in the row's JSON construction, causing the encoder to receive `nil` instead of valid iodata.

  **Fix:** Namespace column values with a `v:` prefix, and represent NULL as `NULL` (no prefix). This ensures:
  - NULL values don't propagate through concatenation
  - NULL and the string literal `'NULL'` produce distinct hashes
  - No restrictions on what values users can have in their columns

- fe2c6b2: Fix ETS read/write race condition in PureFileStorage

  Fixed a race condition where readers could miss data when using stale metadata to read from ETS while a concurrent flush was clearing the ETS buffer. The fix detects both empty and partial ETS reads and retries with fresh metadata, which will correctly read from disk after the flush completes.

- c4dc4c6: Fix hex.pm publishing for Electric package

## 1.3.1

### Patch Changes

- 5a767e6: Add Move-Out Support for Subqueries in Elixir Client
- af2a1f4: fix: mark one more service-specific error as known
- bcda65b: Fix: Return 409 on move-ins/outs for where clauses of the form 'NOT IN (subquery)' since this is not supported yet
- 795a35d: fix: ensure materializer starting after consumer died doesn't log an error

## 1.3.0

### Minor Changes

- cb9f571: Replace in-memory shape metadata storage with SQLite

### Patch Changes

- b11b8ea: Support multiple subqueries on the same level, returning 409s on move-ins/outs
- 9d27e85: Fix handling of explicit casts on query parameters
- 1397e7c: Add function to dynamically re-enable consumer suspension

## 1.2.11

### Patch Changes

- 10c11ac: Disallow multiple subqueries at the same level in where clauses
- 393eca2: Support OR with subqueries with tagged_subqueries feature flag turned on by returning 409s on move-ins or outs
- 12ce210: Fix bug with case-sensitive column names in subqueries

## 1.2.10

### Patch Changes

- dd85d67: fix: wrong return value caused metric sending to fail sometimes
- 3c88770: Remove persistence of metadata from `ShapeStatus` and instead rely on storage for reading and caching.
- 4a28afa: fix: ensure abscense of a materializer doesn't crash a part of electric

## 1.2.9

### Patch Changes

- 5e936f6: fix: correct refs usage inside shape indices
- 4803b5e: Minimize off-heap string allocation for high-frequency ShapeLogCollector process.
- 7804860: fix: ensure correct change handling and transformations on active move-ins

## 1.2.8

### Patch Changes

- e90e24e: fix: ensure correct log reading near the log start, especially when a move-in/out is a first thing in the shape log
  fix: ensure correct processing of move-in/move-out sequences affecting same values
  fix: ensure correct move-in handling without duplicated data
- 90a9867: Fix enum parameters for subsets
- 331676d: Reconcile ShapeStatus ETS backup rather than invalidate when stored shape handles and backed up handles diverge.
- de366ee: Handle ShapeLogCollector shape registrations and deregistrations in separate process to batch them.
- 7e91dba: Guard against `nil` waiters in SLC RequestBatcher correctly.
- ceef72c: Fix incorrect metric name: electric.postgres.replication.{pg_current_wal_lsn => pg_wal_offset}.
- e90e24e: feat: add support for better buffering strategy over move-ins, unlocking 3+ shape layers
- c28e8ed: Extract telemetry code from Electric into a separate package, for easier modification and sharing of the telemetry code between Electric and Cloud.
- 0a82280: Hibernate the shape status owner process to release any memory accumulated during startup
- ebdc25d: Migrate Filter module and indexes from Elixir maps to ETS tables to reduce GC pressure when tracking large numbers of shapes.
- 900b9f1: Don't drop publication with manual_table_publishing
- 7bb6910: Fix a memory leak where for terminated shapes PureFileStorage would still maintain an entry in its ETS table.
- accd2a0: Fix out of bounds errros on requests because of inconsistent virtual snapshot offset recovery.
- fb24539: Reduce memory consumption by filtering transactions to only include the changes that affect the shape
- 0408955: fix(subqueries): make sure tagging works on escaped column names
- bc16173: Fix issue with least recently used ordering with equal timestamps
- eca90d3: Handle out of bounds requests with a timeout, allowing them to potentially be rescued by incoming data.
- 4d8e61f: Refactor shape status to move shape lookups to an external module
- 45e3490: Use ETS table for tracking shapes to avoid unbounded map growth
- a302f66: feat: add support for subqueries without invalidation
- 32ea8f0: feat: add `snapshot-end` messages at the end of every move-in to expose transaction visibility to the clients
- 3272735: Remove redundant behaviour descriptions
- 65edd9f: Reduce PublicationManager memory usage
- 48b6bf0: Allow enums in subset where clauses
- 128c362: Fix a bug in LockBreakerConnection that was preventing it from terminating stuck backends holding the advisory lock.
- 96cacdc: Fix the name of the metrics that reports replication slot's confirmed flush lag and add two new metrics: retained WAL size (the diff between PG's current LSN and the slot's restart_lsn) and the current PG LSN itself which can be used to plot the write rate happening in the database at any given time.
- 0849691: Ensure `ShapeStatus` backup is saved and loaded at the appropriate times to accelerate rolling deploys and controlled restarts.
- e27b72b: Cleanup API config and terminate request handler processes periodically
- b0b9445: Remove suspend_consumers feature flag and disable consumer suspend by default
- 1d5a8a9: Avoid shape definition lookups when requests include a shape handle

## 1.2.7

### Patch Changes

- f0b83fa: Fix subset\_\_params to use constant parameter name for proxy configurations

  Changed subset**params from deepObject style (subset**params[1], subset**params[2]) to JSON serialization (subset**params={"1":"value1","2":"value2"}). This allows proxy configurations to match the constant parameter name "subset\_\_params" in ELECTRIC_PROTOCOL_QUERY_PARAMS without needing dynamic pattern matching.

- 8cbd9fb: Reduce memory usage by terminating consumer processes after the hibernation timeout
- 69e4599: Support LIKE and ILIKE functions in where clauses (LIKE and ILIKE binary operators were already supported)
- 2e19332: Add `log_mode` to shape comparable version for indexing.
- f36be0b: Simplify `ShapeStatus` and remove unused APIs.
- a672d2a: Reduce logging when starting a consumer process
- b62335f: Split `ShapeStatus` relation to shape lookup into separate ETS table to avoid congestion on main metadata table.
- e7b8bd0: Fix shape counting after reload and ensure shape last used repopulation
- d483851: Ensure table and slot names are properly escaped in lock breaker query
- 7d080a3: Load shapes from storage in parallel for faster recovery.
- d492b47: Improve storage initialization performance
- e7b8bd0: Separate `shape def -> handle` lookup into new table
- 7d080a3: Load latest offset from storage when recovering shapes for accurate metadata reconstruction.

## 1.2.6

### Patch Changes

- 2d1d268: Ensure shape consumers idempotently handle transactions using log offset comparisons.
- b71e46c: Fix retry-after header not being exposed via CORS

  The server was sending the retry-after header to clients during overload scenarios (503 responses), but the header was not included in the access-control-expose-headers CORS header. This caused browsers to block access to the retry-after value, preventing clients from honoring the server's backoff directive.

  As a result, clients would ignore the server's retry-after header and use only exponential backoff with jitter, which could result in very short retry delays (as low as 0-100ms on early retries), leading to intense retry loops during server overload.

- ff45de1: Replace max LSN recovery from on-disk shapes with direct read from replication slot flushed LSN.
- 68424c3: Reduce replication client working memory by sending individual operations to ShapeLogCollector rather than whole transactions
- 6bb011b: Remove Shapes.Monitor and re-write shape removal for improved performance
- 5c8b559: Propagate shape subset errors correctly to Ecto.
- b24556b: Reduce memory buildup when calculating least recently used shapes by using `:ets.foldl`.
- d3a60f6: Fix shape delete api call function arguments

## 1.2.5

### Patch Changes

- 58853d2: Remove shape storage metadata backup mechanism now that shape lazy loading is in place.
- 2747a71: Reduce consumers to a single process instead of a supervisor & children
- 6cbcbd6: Isolate call home reporter HTTP request to avoid interference from HTTP pool messages.
- e04af96: Return 503 instead of 400 in case generated column replication is not enabled for PG >=18.
- c4d0ea4: Update `otel_metric_exporter` dependency to fix issues with event handler detachments.
- 55c7ca1: Speed up shape metadata removal
- 4036fb6: Ensure per-shape file operations do not go through Erlang file server to avoid bottlenecks.
- 0c619e6: Support externally defined OTEL resource attributes in the metrics exported from ApplicationTelemetry and StackTelemetry
- 4df1fba: Ensure async deletion requests don't clog up as removal is taking place by moving removal to asynchronous task.
- e204906: Simplify API handling of snapshot errors that result in 503 responses.
- 68b686b: Avoid additionaly syscall when asynchronously deleting things by assuming uniqueness with strong fallback.
- d413fc5: Ensure consumer registry does not crash on a lookup when registry table is missing.
- 9eccb89: Allow snapshot query connection pool to queue up requests for connections for longer to smoothen out bursts.
- 526e379: Fix incorrect run_queue_length metric definition that prevented individual scheduler queue lengths from getting exported.
- f1a5f4f: Fix function arguments for ShapeCache.start_consumer_for_handle/2
- 84c7119: Instrument publication relation updates with appropriate telemetry.
- 766a375: Use longer timeout when waiting for snapshots to start in requests.

## 1.2.4

### Patch Changes

- c7ca1b1: Avoid going through Erlang central file server for deleting shapes through the AsyncDeleter interface.
- e473d16: Parse disk full and duplicate slot file PG errors.
- dab8b15: Guard against missing connection wherever the DB connection pool is used.
- 356b8f6: feat: re-intoroduce admission control
- 7d5da13: Parse Prisma incorrectly formatted Postgres errors into known DB connection errors.

## 1.2.3

### Patch Changes

- a5a0443: Improve resilience of publication configuration updates and minimise queries
- 5e6d3cd: Add write_concurrency to ShapeStatus ETS tables to improve performance under concurrent workloads. Enables `write_concurrency: true` on both LastUsedTable and MetaTable to reduce lock contention during concurrent shape operations, addressing slow deletes with large numbers of shapes.
- 39e2458: Shape subsystem is no longer restarted on a connection failure
- 8f65f04: Handle missing process when examining message queue lengths
- e3c2320: Warn instead of error for publication configuration errors if they are connection errors.
- 7ef355b: Set write_concurrency to :auto for all ETS tables that already have it enabled. This is the recommended setting, per OTP docs.
- a5a0443: Modify `PublicationManager` to commit individual relation configurations while concurrently handling shape registrations to avoid timing out or blocking when updating high number of relations.
- bb1f8d3: Only include schema in 200 responses

## 1.2.2

### Patch Changes

- 5d71990: fix: revert load shedding

## 1.2.1

### Patch Changes

- 67b487b: Handle connection failures during relation changes and new shapes more gracefully
- ff36103: fix: ensure retry-after header is present on errors while stack is starting up

## 1.2.0

### Minor Changes

- e63c398: Remove old FileStorage implementation
- 07977b9: Lazily start existing shape writers when receiving a write to that shape
- 37242f6: Deprecate `experimental_live_sse` and introduce proper `live_sse` flag for sending live updates as server sent events.

### Patch Changes

- 6a8502d: Handle slot invalidations in PG18 more gracefully.
- 02363fe: Add `stack_id` as logger metadata to telemetry reporter.
- 1585136: Validate connection options for lock breaker connection.
- 7e58fb1: Trigger connection system restart on publication misconfiguration or missing to force fresh setup.
- 0c6a56e: Upgrade Elixir to v1.19.1 and Erlang/OTP to 21.1.1
- bec7bfd: Stop reporting disk usage in StackTelemetry, it's too expensive for a regular measurement.
- 0296125: Retire ELECTRIC_EXPERIMENTAL_MAX_SHAPES environment variable
- 656c344: Move exclusive connection lock inside replication connection to reduce number of `wal_sender` processes used from 2 to 1 per instance.
- 816b8e9: Fix publication mishandling by only updating prepared relations in one place.
- fa2660b: Reduce memory footprint of shape consumer processes by avoiding repeating the same path prefix multiple times and calculating shape-specific storage fields on the fly instead.
- 14ce221: Handle requests during stack shutdown more gracefully
- d539102: Add a new configuration option ELECTRIC_REPLICATION_IDLE_TIMEOUT that allows Electric to close database connections automatically when the replication stream is idle. This enables the database server to scale-to-zero on supported providers.
- 6fa0258: Simplify connection status error handling for runtime failures
- 2c84022: Remove unnecessary clearing of storage on initialization"
- 8eb1071: Change expiry policy to expire the excess shapes (the number over MAX_SHAPES) every minute
- a057f9c: Fix deadlock appearing during high concurrency publication updates.
- 19ec2c4: Keep track of process inboxes when they exceed the "long message queue" threshold. Adjust all system threshold to be more in line with the expected runtime characteristics of the VM in prod.
- 3ddf777: Post a scaled_down_database_connections stack event when the connection subsystem is stopped.
- 519b936: Parse more DB errors as retryable (`ssl connect: closed` and `connection_refused` with PG code 08006).
- 1c1f59c: Ensure publication update failures only affect relevant shapes
- 562d290: Restore ShapeLogCollector's state from the ShapeStatus ETS table at startup
- 852ec59: Restore shapes in `PublicationManager` via the `ShapeStatus` ETS to avoid message congestion.
- 73e6363: Increased resilience when connection unavailable while processing a transaction
- a212279: Support generated column replication in Postgres 18 with new `publish_generated_columns = stored` setting on publication.
- 8f38a11: Parse compute node unreachable database errors as retryable.
- 9cf77e5: Properly handle reconnections during setup of connection manager
- b5879ae: Expose more BEAM VM metrics in ApplicationTelemetry that can be exported via OTEL.
- 4f7aef1: Ensure the lock breaker connection is not linked to the connection manager to avoid unnecessary crashes.
- c3e2582: fix: ensure shapes with subqueries are deserialized correctly when loading from disk, and materializers are properly started
- 130af7a: Handle cached schema inspector failures more gracefully (missing cache table, no connection available)
- 8f38a11: Ensure pool shutdown does not log independent exit error

## 1.1.14

### Patch Changes

- 550ebd1: Fix recovery of incomplete shape data

## 1.1.13

### Patch Changes

- 47029ef: fix: ensure metrics for live/normal requests are correctly split

## 1.1.12

### Patch Changes

- 0de17a8: Fix constant hibernate->wakeup->hibernate loop for shape consumers by only sending a flushed message if there was data in the write buffer
- e86543b: Simplify `PublicationManager` to not require a full shape to remove existing tracked shape.
- d11b5c4: Detect stack termination and mark as down immediately
- 8b9aab4: Optimize shape counting by not copying all shapes from ETS into process memory.
- c2b44ec: Fix async cleanup of storage files across filesystem boundaries
- aa48e04: feat: add a `snapshot-end` control message to the end of snapshots
- bb34680: Expire shapes in batches of a fixed size
- a006938: Parse pooler login errors as retryable errors and `econnrefused` as retryable.
- 698731d: feat: remove a stuck lock if underlying slot is not active
- ef7d788: Optimise removing a shape from where clause filter indexes
- 334b17a: Correctly wrap filesystem errors from the snapshot process
- 12c55f9: Return a descriptive error to the shape request when Electric doesn't have read access to the database table.
- bf5d0fd: Remove consumer startup bottleneck by lazily registering shape consumer processes
- 0b88cea: Spead up shape counting and LRU shape expiration by storing last access timestamps in a separate ETS table.
- c9846f6: Remove unncecessary `refresh_publication` API from `PublicationManager`.
- cf68fe5: Improve startup and shutdown times for shape processes by partitioning DynamicConsumerSupervisor.
- 71306c2: Include memory usage statistics in otel export
- d4ed4cf: Introduce `AsyncDeleter` service for fast batch deletes, done by renaming deprecated files into a temporary directory and batch deleting them in the background.
- da7a456: Fix race condition between removing and adding new shapes concurrently that led to crashes.
- b89ac5a: Faster purging of all shape data in case of timeline or replication slot change.
- 44adea5: Add telemetry to profile shape unsubscription
- 5ca7997: Set full sentry metadata everywhere
- 370ad3f: Move shape deletion operations into separate process to avoid blocking `ShapeCache` on critical path.
- 4abcb3e: Simplify `Connection.Manager` restart logic to restart whole stack in case of replication client failure.
- a3cef79: Fix premature replies to concurrent publication updates for same shape handle.
- 596c7df: Decouple `PublicationManager` initialisation from `ShapeCache`, simplifying startup procedure.
- 98ce149: Handle pool timeouts and disconnections in the DB Inspector more gracefully
- 91adf58: Log offending data with OTEL encoding errors
- 4a832d0: Handle connection unavailable in inspector when validating requests
- 0724b43: fix: rename `ELECTRIC_QUERY_DATABASE_URL` to `ELECTRIC_POOLED_DATABASE_URL` env variable to avoid confusion
- 965ef47: feat: add support for `changes_only` mode, subset snapshots, and `offset=now`
  - `changes_only` - in this mode the server will not create initial snapshot for the shape, the clients will start receiving changes without seeing base data. Best paired with...
  - Subset snapshots - the server now accepts a `subset__*` set of parameters, which when provided result in a special-form response containing a snapshot of a subset (may be full) of a shape, and information on how to position this response in the stream. The client exposes a new method `requestSnapshot` which will make this request and then inject the response into the correct place in the subscribed messages stream, bounded with a `snapshot-end` control message.
  - `offset=now` - the server now accepts a `offset=now` special value, in which case the client will receive an immediate up-to-date response with the latest possible continuation offset, allowing it to skip all historical data and start "from scratch". This works best with `changes_only` and subset snapshots where a client doesn't keep state and upon a reload needs to start fresh without historical data.

- d028070: feat: add timeout to first data on snapshots to avoid long-running queries

## 1.1.11

### Patch Changes

- 0c60056: Enable clean shutdown of connection manager while waiting for connection resolution to complete
- c978ee6: Split pg connections across two pools so that high demand for snapshots doesn't interfere with the ability to introspect tables, configure the publication or monitor the WAL size
- 662e55a: Improve performance of LRU shape expiry
- 107a18d: Simplify `PublicationManager` to only track relations.
- c978ee6: Move connection opts resolution out of connection manager into a separate synchronous function call

## 1.1.10

### Patch Changes

- 8623e73: Avoid crashing ETS inspector if unable to grab DB connection to not lose cache.
- 705deee: Ensure all stack telemetry adds `telemetry_span_attrs` to its metadata.
- 142cfd9: Do not crash `ReplicationClient` if `ShapeLogCollector` is missing - wait for it to get back up.
- 705deee: Fix `electric.postgres.replication.transaction_received.bytes` metric to use actual transaction size.
- 6078121: Fix the mismatch between implementation and reference docs for the ELECTRIC_STORAGE config option.
- 6316827: Ensure flush tracker handles progressive flush acknowledgements under continuous use. Fixes issue where under heavy load acknowledgements would be delayed.
- a955063: feat: allow composite keys everywhere in subqueries
- 1c55d2a: feat: allow $n param usage in subqueries

## 1.1.9

### Patch Changes

- 3325b9a: Turn `feature_flags` into an explicit API+StackSupervisor configuration.
- 437ef17: Wait for stack to be ready before doing API.predefined_shape/2

## 1.1.8

### Patch Changes

- 324d1b8: Improve connection manager's handling of shape process crashes and remove shape log collector monitoring.
- f4d54ef: Ensure replication slot is dropped if requested upon termination
- 33e3d43: feat: close file handles on inactive shapes and don't open on startup
- f888d0a: Lower log level of request logs from `info` to `debug` - too verbose.
- b6b9a77: feat: support non-PK selects in subqueries
- 02faf7c: Parse DB error about remaining slots being reserved as insufficient resources.
- cc65a88: feat: support 3+ layers of subqueries
- b92909a: Add controlled shutdown backing up of storage and shape metadata for significantly faster recovery on restart.

## 1.1.7

### Patch Changes

- 375ba10: fix: ensure correct acknowledgements on silent PG after electric restart
- ade2f42: fix: ensure skipped transactions are still marked as flushed
- 2b71260: Ensure flush timer always gets reset to guarantee write buffer is always emptied.
- e49342b: fix: memory leak on internal flush tracker structure & usage of a correct shape id when cleaning up
- 3b3f743: Prevent pool connections from starting if supervisor is found to already be dead.
- bd42233: Add logger metadata flag for postgrex processes
- 3b3f743: Change order of replication supervisor processes to ensure consumers can perform all operations.

## 1.1.6

### Patch Changes

- 8beda6f: fix: flush tracker was using wrong shape identity
- ee4826e: Gracefully handle termination while waiting for stack readiness

## 1.1.5

### Patch Changes

- 6358ce6: Gracefully handle NULL values when deriving a record key.
- 25313bd: fix: ensure flush timer is properly reset
- 10de9cb: Prevent derivation of the same record key from different relations.
- 4decc4e: Handle missing publication at runtime by dropping slot and restarting - expected to happen with manual editing of Electric slots and publications.
- e5f79c3: Disable the use of row filters in the Postgres publication.
- 2c19914: Ensure 409s do not lead to infinite request cycles because of caching.
- 727de25: Parse DB query cancellation errors as retryable.
- 49ac877: Move `ShapeStatus` ETS table to initialise before all consumers and `ShapeCache`.
- 1d268b5: Add a configuration option ELECTRIC_MANUAL_TABLE_PUBLISHING. Setting it to true
  disables Electric's automatic addition/removal of tables from the Postgres
  publication.

  This is useful when the database role that Electric uses to connect to Postgres
  does not own user tables. Adding tables to the publication by hand and
  setting their REPLICA IDENTITY to FULL allows Electric to stream changes from
  them regardless.

## 1.1.4

### Patch Changes

- 1c0103c: Fully monitor pool connections and gracefully handle failures.
- 90eadb2: Include span metrics even if the OTEL span has been not included because of sampling

## 1.1.3

### Patch Changes

- 871d4e9: fix: make sure the flush acknowledgements are advancing on WAL slot advancement
- e377333: Introduce a new configuration option ELECTRIC_DATABASE_CA_CERTIFICATE_FILE that enables Electric to verify the database server identity when establishing a secure connection to it.
- a26544e: Handle cases where telemetry `:cpu_sup` calls errors gracefully.
- 9d09390: Parse more TCP DB connection timeout errors

## 1.1.2

### Patch Changes

- 5b340f0: Log warning rarther than error if the shape cleanup tasks time out
- 3e295ad: Parse more password authentication DB connection errors

## 1.1.1

### Patch Changes

- ad15a16: fix: improve startup time of Electric when a lot of shapes are present
- 1da5ef0: fix: ensure dependent applications have a sane otel sampling default
- 1b26756: Make Sentry logger handler ID configurable.
- d6173a5: Capture postgres client exits as known and retryable errors.
- 007b196: Lock connection should fail after timing out on connection or handshake to avoid getting stuck.
- 71b3d3b: fix: ensure CPU reporter doesn't crash
- 213d247: Ensure service can recover from unhandleable replication slots, in cases such as too large transactions or incorrectly configured replica identity.
- c5a2d6c: Don't fail cleanup if directory is already missing
- e8b6832: Parse more DB errors correctly `pg_code 08P01`
- 028c45c: Check for changes since request start in SSE requests.
- cb0e484: fix: ensure Electric doesn't accept where clauses that aren't boolean
- 6ee031e: fix: fix a crash because of wrong in-memory state initialization for storage
- f26a425: fix: ensure no crash on restarting the connection process at a weird time
- 028c45c: Fix streaming of last virtual offset.
- 3ca82d7: fix: improve CPU usage of PureFileStorage by lowering syscall count
- 5dfb8fa: Extend replication processing telemetry to cover the entire processing loop
- 753f9a3: Update pg_query_ex to 0.9 to benefit from parallel compilation speedup
- 5dfb8fa: Sample telemetry at source for faster replication stream processing

## 1.1.0

### Minor Changes

- 19e267b: feat: added a new storage engine, replacing the old one by default

  New engine brings about a very nice speedup for reads, writes, and scalability. If you want the old one, you can use `ELECTRIC_STORAGE=file` environment variable.

### Patch Changes

- 64526b7: Ignore pool connection `:DOWN` messages with reason `:noproc`
- a805e19: Ensure telemetry handlers are detached when the relevant telemetry processes die.
- 569b69f: Ensure publication manager is given pg_version to remove redundant queries

## 1.0.24

### Patch Changes

- 23ccafd: Add ELECTRIC_TCP_SEND_TIMEOUT to allow configuration of TCP/SSL send timeout
- bd43b35: Handle more pool connection disconnect exit reasons
- 26528a0: Add more connection errors to recognized list (timeouts, pool timeouts, data tranfser quota issues, insufficient resources, unknown endpoint)

## 1.0.23

### Patch Changes

- 8ff69b8: fix: account for PG14 when calculating if publication needs updating
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
