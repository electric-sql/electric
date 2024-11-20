# @electric-sql/client

## 0.7.3

### Patch Changes

- 5063314: Exposed `.lastOffset` as a public read only property on `Shape` and `ShapeStream`.
- 71d61b5: Verify that fetch response contains required Electric headers.

## 0.7.2

### Patch Changes

- 65af31c: Add params option when creating shapes
- 90ead4f: Support for managing multiple databases on one Electric (multi tenancy).

## 0.7.1

### Patch Changes

- b367c8d: Make the client table option _not_ required as a team using a proxy API might set the table there.

## 0.7.0

### Minor Changes

- 61a18bd: - Implement `rows` and `currentRows` getters on `Shape` interface for easier data access.
  - [BREAKING] Rename `valueSync` getter on `Shape` to `currentValue` for clarity and consistency.
  - [BREAKING] Change `subscribe` API on `Shape` to accept callbacks with signature `({ rows: T[], value: Map<string, T> }) => void`
- 4d872b6: All `Shape` interfaces (`ShapeStream`, `Shape`, `useShape`) now require `table` as an additional configuration parameter, and the shape API endpoint url only needs to point to `/v1/shape`.
- 4d872b6: [breaking] Changes the API contract for the server to use new, clearer header names and query parameter names. One highlight is the change from `shape_id` to `handle` as the URL query parameter

### Patch Changes

- aed079f: Add `replica` parameter to change the behaviour for updates to include the full row, not just the modified columns

## 0.6.5

### Patch Changes

- 7de9f1d: Handle 400 errors as unrecoverable rather than `must-refetch` cases

## 0.6.4

### Patch Changes

- 7f86b47: Fix prefetch logic to stop prefetching as soon as responses stop advancing.

## 0.6.3

### Patch Changes

- 25c437f: Implement `columns` query parameter for `GET v1/shapes` API to allow filtering rows for a subset of table columns.

## 0.6.2

### Patch Changes

- c0c9af6: Handle 429 responses with retries.
- 41845cb: Fix inconsistencies in http proxies for caching live long-polling requests.

  The server now returns a cursor for the client to use in requests to cache-bust any stale caches.

## 0.6.1

### Patch Changes

- cfb7955: Implement utility `headers` option on `ShapeStream` to pass headers to attach to all requests, like authorization.
- c980a76: Make parser generic such that it can be parameterized with additional types supported by custom parsers.

## 0.6.0

### Minor Changes

- b0d258d: Rename Electric's custom HTTP headers to remove the x- prefix.

### Patch Changes

- df6cc5b: Wait for `ShapeStream` subscriber callbacks before requesting data to allow developer to implement backpressure.
- e459a62: Implement configurable chunk prefetching to `ShapeStream` to accelerate stream consumption.

## 0.5.1

### Patch Changes

- 9992a74: Client refactor and fix `Shape` state synchronization with `ShapeStream`.
- 70da0b5: Expose lastSyncedAt field in ShapeStream and Shape classes and in the useShape React hook.

## 0.5.0

### Minor Changes

- 7765d50: Expose isLoading status in ShapeStream and Shape classes and in useShape React hook.

## 0.4.1

### Patch Changes

- e3a07b7: Return 400 if shape ID does not match shape definition. Also handle 400 status codes on the client.
- 412ea8e: Fix bug that occured when parsing column named "value" with a null value.

## 0.4.0

### Minor Changes

- fe251c8: Expose a `lastSyncedAt` field on the `ShapeStream` and `Shape` classes which is the time elapsed since the last sync with Electric (in milliseconds). Remove the `isUpToDate` field on the `Shape` class.

### Patch Changes

- fe251c8: Expose an `isConnected` method on `ShapeStream` and `Shape` classes.

## 0.3.4

### Patch Changes

- 42a51c3: Allow specifying data type through type templating in `ShapeStream` and `Shape` APIs.

## 0.3.3

### Patch Changes

- d3b4711: Fix nullable array fields not being parsed as `null`.

## 0.3.2

### Patch Changes

- a6c7bed: Add `Message` type guard helpers `isChangeMessage` and `isControlMessage`.

## 0.3.1

### Patch Changes

- 09f8636: Include nullability information in schema. Also parse null values in the JS client.

## 0.3.0

### Minor Changes

- 8e584a1: Fix: rename "action" header -> "operation" to match Postgres's name for inserts, updates, deletes

## 0.2.2

### Patch Changes

- 06e843c: Only include schema in header of responses to non-live requests.
- 22f388f: Parse float4 into a JS Number in the JS ShapeStream abstraction.

## 0.2.1

### Patch Changes

- 5c43a31: Parse values of basic types (int2, int4, int8, float8, bool, json/jsonb) and arrays of those types into JS values on the client.

## 0.2.0

### Minor Changes

- 1ca40a7: feat: refactor ShapeStream API to combine and to better support API proxies

## 0.1.1

### Patch Changes

- c3aafda: fix: add prepack script so typescript gets compiled before publishing

## 0.1.0

### Minor Changes

- 36b9ab5: Update the client to work correctly with patch (instead of full) updates

## 0.0.8

### Patch Changes

- fedf95c: fix: make packaging work in Remix, etc.

## 0.0.7

### Patch Changes

- 4ce7634: useShape now uses useSyncExternalStoreWithSelector for better integration with React's rendering lifecycle

## 0.0.6

### Patch Changes

- 324effc: Updated typescript-client README and docs page.

## 0.0.5

### Patch Changes

- 7208887: Fix `fetch` not being bound correctly

## 0.0.4

### Patch Changes

- 958cc0c: Respect 409 errors by restarting the stream with the new `shape_handle`.

## 0.0.3

### Patch Changes

- af3452a: Fix empty initial requests leading to infinite loop of empty live requests.
- cf3b3bb: Updated package author, license and homepage.
- 6fdb1b2: chore: updated testing fixtures

## 0.0.2

### Patch Changes

- 3656959: Fixed publishing to include built code
