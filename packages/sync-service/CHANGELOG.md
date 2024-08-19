# @core/sync-service

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
