# @core/sync-service

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

- e3a07b7: Return 400 if shape ID does not match shape definition. Also handle 400 status codes on the client.
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
