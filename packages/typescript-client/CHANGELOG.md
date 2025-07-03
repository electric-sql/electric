# @electric-sql/client

## 1.0.6

### Patch Changes

- 7be2fd3: Buffer SSE messages until up-to-date message to avoid duplicate operations from being published on the shape stream.

## 1.0.5

### Patch Changes

- c59000f: Add experimental SSE support.

## 1.0.4

### Patch Changes

- d12ff0f: Pause and resume shapestream on visibility changes.

## 1.0.3

### Patch Changes

- 22cde89: Maintain backwards compatibility of client for 204 responses

## 1.0.2

### Patch Changes

- d278b9f: fix!: Convert live responses with no changes from `204` to `200`.

  BREAKING CHANGE: community clients relying on `204` alone for up-to-date logic might break - live responses now always return a `200` with a body/

## 1.0.1

### Patch Changes

- 56c338a: Surface errors from consuming response body as `FetchError`s in regular handling flow

## 1.0.0

### Minor Changes

- f1a9247: feat!: change the wire protocol to remove `offset` and add an explicit `lsn` header. Only valid offset now is the one provided in headers

### Patch Changes

- 1255205: First beta release
- ade15b9: Expose `shape.stream` as public readonly property.
- 91774d3: Cleanup `AbortSignal` chained listeners to avoid memory leaks.
- 0dd1f0c: feat: add support for parameters in where clauses to clients
- 1c28aee: Start streaming only after at least one subscriber is present.
- ade15b9: Use "get" instead of "has" for checking searchParams

  Not all implementations of JS have the has(name, value) syntax e.g. Expo.

- 19a7ab3: Simplify `Shape` subscriber notification mechanism
- 6616b81: Correctly set the cache busting url param when using `forceDisconnectAndRefresh`
- dcd8a9f: feat: add `old_value` to updates under replica mode `full`
- dd5aeab: This PR adds support for function-based options in the TypeScript client's params and headers. Functions can be either synchronous or asynchronous and are resolved in parallel when needed.

  ```typescript
  const stream = new ShapeStream({
    url: 'http://localhost:3000/v1/shape',
    params: {
      table: 'items',
      userId: () => getCurrentUserId(),
      filter: async () => await getUserPreferences(),
    },
    headers: {
      Authorization: async () => `Bearer ${await getAccessToken()}`,
    },
  })
  ```

  ## Common Use Cases

  - Authentication tokens that need to be refreshed
  - User-specific parameters that may change
  - Dynamic filtering based on current state
  - Multi-tenant applications where context determines the request

## 1.0.0-beta.5

### Patch Changes

- 91774d3: Cleanup `AbortSignal` chained listeners to avoid memory leaks.
- 19a7ab3: Simplify `Shape` subscriber notification mechanism

## 1.0.0-beta.4

### Patch Changes

- 6616b81: Correctly set the cache busting url param when using `forceDisconnectAndRefresh`
- dcd8a9f: feat: add `old_value` to updates under replica mode `full`

## 1.0.0-beta.3

### Minor Changes

- f1a9247: feat!: change the wire protocol to remove `offset` and add an explicit `lsn` header. Only valid offset now is the one provided in headers

## 1.0.0-beta.2

### Patch Changes

- ade15b9: Expose `shape.stream` as public readonly property.
- 1c28aee: Start streaming only after at least one subscriber is present.
- ade15b9: Use "get" instead of "has" for checking searchParams

  Not all implementations of JS have the has(name, value) syntax e.g. Expo.

- dd5aeab: This PR adds support for function-based options in the TypeScript client's params and headers. Functions can be either synchronous or asynchronous and are resolved in parallel when needed.

  ```typescript
  const stream = new ShapeStream({
    url: 'http://localhost:3000/v1/shape',
    params: {
      table: 'items',
      userId: () => getCurrentUserId(),
      filter: async () => await getUserPreferences(),
    },
    headers: {
      Authorization: async () => `Bearer ${await getAccessToken()}`,
    },
  })
  ```

  ## Common Use Cases

  - Authentication tokens that need to be refreshed
  - User-specific parameters that may change
  - Dynamic filtering based on current state
  - Multi-tenant applications where context determines the request

## 1.0.0-beta.1

### Patch Changes

- 1255205: First beta release

## 0.9.1

### Patch Changes

- 9886b08: Expose `shape.stream` as public readonly property.
- dae3b0d: Fix node 16 cjs import
- fbb66e9: Use "get" instead of "has" for checking searchParams

  Not all implementations of JS have the has(name, value) syntax e.g. Expo.

## 0.9.0

### Minor Changes

- 9c50e8f: [BREAKING]: Remove databaseId option from ShapeStream in favor of params option.
- e96928e: [BREAKING]: Move non-protocol options like table & where to the params sub-key

  ## Context

  Electric's TypeScript client is currently tightly coupled to PostgreSQL-specific options in its `ShapeStreamOptions` interface. As Electric plans to support multiple data sources in the future, we need to separate protocol-level options from source-specific options.

  ## Changes

  1. Created a new `PostgresParams` type to define PostgreSQL-specific parameters:
     - `table`: The root table for the shape
     - `where`: Where clauses for the shape
     - `columns`: Columns to include in the shape
     - `replica`: Whether to send full or partial row updates
  2. Moved PostgreSQL-specific options from the top-level `ShapeStreamOptions` interface to the `params` sub-key
  3. Updated `ParamsRecord` type to include PostgreSQL parameters
  4. Updated the `ShapeStream` class to handle parameters from the `params` object
  5. Updated documentation to reflect the changes

  ## Migration Example

  Before:

  ```typescript
  const stream = new ShapeStream({
    url: 'http://localhost:3000/v1/shape',
    table: 'users',
    where: 'id > 100',
    columns: ['id', 'name'],
    replica: 'full',
  })
  ```

  After:

  ```typescript
  const stream = new ShapeStream({
    url: 'http://localhost:3000/v1/shape',
    params: {
      table: 'users',
      where: 'id > 100',
      columns: ['id', 'name'],
      replica: 'full',
    },
  })
  ```

### Patch Changes

- af0c0bf: Always use sorted query parameters in official clients to ensure Shape URLs are cached consistently.

## 0.8.0

### Minor Changes

- 12fd091: [BREAKING] Remove subscribeOnceToUpToDate method from ShapeStream. Instead, you should subscribe to the stream and check for the up-to-date control message.

### Patch Changes

- 5a7866f: refactor: improve error handling with new error classes & stream control

  - Add `onError` handler to ShapeStream for centralized error handling
  - Add new error classes:
    - MissingShapeUrlError
    - InvalidSignalError
    - MissingShapeHandleError
    - ReservedParamError
    - ParserNullValueError
    - ShapeStreamAlreadyRunningError
  - Improve error propagation through ShapeStream lifecycle

- de204fc: Allow error handler to modify HTTP query parameters and headers to retry failed HTTP request.
- 1faa79b: Add link to troubleshooting guide in the MissingHeadersError.
- c748ec7: Exposed `shape.handle` getter on `Shape` and rename `shapeHandle` to `handle` in the `ShapeStreamOptions`.

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
