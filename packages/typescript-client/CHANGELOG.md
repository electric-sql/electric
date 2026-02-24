# @electric-sql/client

## 1.5.8

### Patch Changes

- 8600d25: Add fast-loop detection with automatic cache recovery to ShapeStream. When the client detects rapid requests stuck at the same offset (indicating stale client-side caches or proxy/CDN misconfiguration), it clears the affected shape's cached state and resets the stream to fetch from scratch. If the loop persists, exponential backoff is applied before eventually throwing a diagnostic error.
- 1e1123b: Fixed `isControlMessage` type guard crashing on messages without a `control` header (e.g. `EventMessage`s or malformed responses). The function previously used a negation check (`!isChangeMessage()`) which misclassified any non-change message as a `ControlMessage`, causing `TypeError: Cannot read property 'control' of undefined` in `Shape.process_fn`. Now uses a positive check for `'control' in message.headers`, consistent with how `isChangeMessage` checks for `'key' in message`.
- e172d4b: Increase default retry backoff parameters to reduce retry storms when a proxy fails, aligning with industry-standard values (gRPC, AWS). `initialDelay` 100ms → 1s, `multiplier` 1.3 → 2, `maxDelay` 60s → 32s. Reaches cap in 5 retries instead of ~25.

## 1.5.7

### Patch Changes

- ca931d9: Fix BigInt values in subset loading parameters causing `JSON.stringify` to throw "Do not know how to serialize a BigInt". Values from parsed int8 columns can now be passed directly as `requestSnapshot`/`fetchSnapshot` params without manual conversion.
- 858e13d: Fix on-demand mode (`offset: "now"`) to advance the stream's offset/handle after a cold-start `requestSnapshot()`, so the stream resumes from the snapshot's position rather than the stale `"now"` offset. Prevents updates committed between the snapshot and the stream's next live poll from being missed.

## 1.5.6

### Patch Changes

- 4c7855b: Fix prefetch buffer incorrectly serving cached GET responses to POST subset/snapshot requests that share the same URL, which could route stream chunks into the subset handler.
- c84d985: Fix handling of deprecated 204 responses from old Electric servers. Previously, a 204 ("no content, you're caught up") only updated `lastSyncedAt` but never transitioned to the live state, so `isUpToDate` stayed false, `live=true` was never added to the URL, and subscribers waiting for the up-to-date signal were never notified. The bug is inert with current servers (which never send 204) but would cause an infinite catch-up polling loop against older servers.

## 1.5.5

### Patch Changes

- e9bc504: Fix `TypeError: Cannot use 'in' operator` crash when a proxy or CDN returns a non-array JSON response from the shape endpoint. Add null-safety to message type guards and throw a proper `FetchError` for non-array responses so the existing retry/backoff infrastructure handles it.

## 1.5.4

### Patch Changes

- 186b8f8: Properly bundle `fetch-event-source`, so consumer use patched version.

  When liveSse mode got introduced, it included `fetch-event-source` which is used instead of built-in `EventSource` because of richer capabilities. However, it had a few assumptions (document/window existence) + bugs, when it comes to aborting. This was patched, however, when building `typescript-client` patched version isn't included and when user uses it - they have unpatched version.

## 1.5.3

### Patch Changes

- 9698b03: Add PauseLock to coordinate pause/resume across visibility changes and snapshot requests, preventing race conditions where one subsystem's resume could override another's pause.
- b0cbe75: Fix crash when receiving a stale cached response on a resumed session with no schema yet. When the client resumes from a persisted handle/offset, the schema starts undefined. If the first response is stale (expired handle from a misconfigured CDN), the response is ignored and body parsing is skipped — but the code then accesses `schema!`, which is still undefined, causing a parse error. Now the client skips body parsing entirely for ignored stale responses.
- b0cbe75: Refactor ShapeStream's implicit sync state into an explicit state machine using the OOP state pattern. Each state (Initial, Syncing, Live, Replaying, StaleRetry, Paused, Error) is a separate class carrying only its relevant fields, with transitions producing new immutable state objects. This replaces the previous flat context bag where all fields existed simultaneously regardless of the current state.
- b0cbe75: Fix infinite loop when the client resumes with a persisted handle that matches an expired handle. The stale cache detection assumed that having a local handle meant it was different from the expired one, so it returned "ignored" instead of retrying with a cache buster. When `localHandle === expiredHandle`, the client would loop forever: fetch stale response, ignore it, retry without cache buster, get the same stale response. Now the client correctly enters stale-retry with a cache buster when its own handle is the expired one.

## 1.5.2

### Patch Changes

- 091a232: Fix ShapeStream hanging after system sleep in non-browser environments (Bun, Node.js). Stale in-flight HTTP requests are now automatically aborted and reconnected on wake, preventing hangs until TCP timeout.

## 1.5.1

### Patch Changes

- 42aee8a: Fix 409 must-refetch error handling in fetchSnapshot. The method now correctly catches FetchError exceptions thrown by the fetch wrapper chain, matching the pattern used by the main request loop.
- fef494e: Fix stale CDN response incorrectly updating client offset. When a CDN returns a cached response with an expired shape handle, the client now ignores the entire response (including offset) to prevent handle/offset mismatch that would cause server errors.

## 1.5.0

### Minor Changes

- 3f257aa: Add POST support for subset snapshots to avoid URL length limits. Clients can now send subset parameters (WHERE clauses, ordering, pagination) in the request body instead of URL query parameters, preventing HTTP 414 errors with complex queries or large IN lists.

## 1.4.2

### Patch Changes

- a428324: Fix infinite loop in replay mode when CDN returns the same cursor repeatedly. The client now exits replay mode after the first suppressed up-to-date notification, preventing the loop while still correctly suppressing duplicate notifications from cached responses.

## 1.4.1

### Patch Changes

- 6d6e199: Fix infinite loop when response is missing required headers

  When the server returns 200 OK but with missing required headers (like `electric-cursor`), the client would enter an infinite retry loop if `onError` returned `{}`. Now `MissingHeadersError` is treated as non-retryable since it's a configuration issue that won't self-heal.

- 594afee: Fix stale cached responses with expired shape handles

  When a CDN/proxy is misconfigured and serves a stale cached response with an expired shape handle, the client would get into a broken state where the handle was rejected but the offset was still advanced. This fix detects stale responses and triggers a retry with a cache buster parameter to bypass the misconfigured CDN cache.

## 1.4.0

### Minor Changes

- 78fc0ae: Add structured subset params support (whereExpr, orderByExpr) to enable proper columnMapper transformations for subset queries. When TanStack DB sends structured expression data alongside compiled SQL strings, the client can now apply column name transformations (e.g., camelCase to snake_case) before generating the final SQL.

## 1.3.1

### Patch Changes

- f6e7c75: Fix infinite 409 loop when proxy returns stale cached response with expired shape handle.

  **Root cause:** When a 409 response arrives, the client marks the old handle as expired and fetches with a new handle. If a proxy ignores the `expired_handle` cache buster parameter and returns a stale cached response containing the old handle, the client would accept it and enter an infinite 409 loop.

  **The fix:**
  - In `#onInitialResponse`: Don't accept a shape handle from the response if it matches the expired handle in the expired shapes cache
  - In `getNextChunkUrl` (prefetch): Don't prefetch the next chunk if the response handle equals the `expired_handle` from the request URL
  - Added console warnings when this situation is detected to help developers debug proxy misconfigurations

  This provides defense-in-depth against misconfigured proxies that don't include all query parameters in their cache keys.

## 1.3.0

### Minor Changes

- ed98c6b: feat: denote end of injected subset snapshot with an additional message

### Patch Changes

- 8fd8c8f: Fix memory leak from recursive async functions by upgrading TypeScript target to ES2017.

  The ES2016 target caused async/await to be transpiled using the `__async` helper which creates nested Promise chains that cannot be garbage collected when recursive async functions like `requestShape()` call themselves. With ES2017+, native async/await is used which doesn't have this issue.

- 5ab082b: Fix stream stopping after tab visibility changes due to stale aborted requests in PrefetchQueue.

  **Root cause:** When a page is hidden, the stream pauses and aborts in-flight prefetch requests. The aborted promises remained in the PrefetchQueue's internal Map. When the page became visible and the stream resumed, `consume()` returned the stale aborted promise, causing an AbortError to propagate to ShapeStream and stop syncing.

  **The fix:**
  - `PrefetchQueue.consume()` now checks if the request's abort signal is already aborted before returning it
  - `PrefetchQueue.abort()` now clears the internal map after aborting controllers
  - The fetch wrapper clears `prefetchQueue` after calling `abort()` to ensure fresh requests

  Fixes #3460

## 1.2.2

### Patch Changes

- c8ad84a: Fix columnMapper to support loading subsets. When using `columnMapper` with ShapeStream, the `columns` parameter is now properly encoded from application column names (e.g., camelCase) to database column names (e.g., snake_case) before transmission to the server.

## 1.2.1

### Patch Changes

- a302f66: feat: add support for subqueries without invalidation
- 3f3c078: Add SSE-related headers to client requests

## 1.2.0

### Minor Changes

- 18df5a5: Add bidirectional column mapping API for query filters with built-in snake_case ↔ camelCase support. Introduces `columnMapper` option to `ShapeStream` that handles both encoding (TypeScript → Database) for WHERE clauses and decoding (Database → TypeScript) for results. Includes `snakeCamelMapper()` helper for automatic snake_case/camelCase conversion and `createColumnMapper()` for custom mappings. The new API deprecates using `transformer` solely for column renaming, though `transformer` remains useful for value transformations like encryption.

### Patch Changes

- f0b83fa: Fix subset\_\_params to use constant parameter name for proxy configurations

  Changed subset**params from deepObject style (subset**params[1], subset**params[2]) to JSON serialization (subset**params={"1":"value1","2":"value2"}). This allows proxy configurations to match the constant parameter name "subset\_\_params" in ELECTRIC_PROTOCOL_QUERY_PARAMS without needing dynamic pattern matching.

- cd15a56: Fix multiple renders from cached up-to-date messages on page refresh. When a shape receives multiple updates within the HTTP cache window (60s), each update ends with an up-to-date control message that gets cached. On page refresh, these cached responses replay rapidly, causing multiple renders. This change implements cursor-based detection to suppress cached up-to-date notifications until a fresh response (with a new cursor) arrives from the server, ensuring only one render occurs.

## 1.1.5

### Patch Changes

- aacfba4: Expose the ShapeStream.fetchSnapshot as a public api that can be used to fetch a snapshot without it being injected into the emitted stream of change messages. This is useful for cases where the user wants to handle the application of these snapshot in a custom way.

## 1.1.4

### Patch Changes

- b377010: Fix race condition where collections get stuck and stop reconnecting after rapid tab switching, particularly in Firefox.

  **Root cause:** Two race conditions in the pause/resume state machine:
  1. `#resume()` only checked for `paused` state, but `#pause()` sets an intermediate `pause-requested` state. When visibility changes rapidly, `#resume()` is called before the abort completes, leaving the stream stuck.
  2. Stale abort completions could overwrite the `active` state after `#resume()` has already started a new request.

  **State machine flow:**

  ```
  Normal pause:
    active → pause() → pause-requested → abort completes → paused

  Interrupted pause (rapid tab switch):
    active → pause() → pause-requested → resume() → active
             ↑                              ↑
             abort starts              resumes immediately,
                                       prevents stuck state
  ```

  **Additional fix:** Memory leak where visibility change event listeners were never removed, causing listener accumulation and potential interference from stale handlers.

## 1.1.3

### Patch Changes

- 5c24974: add `live_sse` to ELECTRIC_PROTOCOL_QUERY_PARAMS

## 1.1.2

### Patch Changes

- e4f2c4d: Fix duplicate operations being emitted after error recovery with `onError` handler. When the `onError` handler returned new params/headers to retry after an error (e.g., 401), the stream was resetting its offset and refetching all data from the beginning, causing duplicate insert operations and "already exists" errors in collections. The stream now correctly preserves its offset during error recovery and continues from where it left off.

## 1.1.1

### Patch Changes

- ff36103: fix: ensure retry-after header is present on errors while stack is starting up

## 1.1.0

### Minor Changes

- 37242f6: Deprecate `experimental_live_sse` and introduce proper `live_sse` flag for sending live updates as server sent events.

### Patch Changes

- 37242f6: Handle 409 must refetch message from both SSE and long poll fetches correctly.
- a328418: Ensure `FetchBackoffAbortError` is emitted even if aborting while request body is being streamed.

## 1.0.14

### Patch Changes

- 3775bf6: Revert the shardSubdomain mechanism to avoid CORS and subdomain resolution issues in Safari.

## 1.0.13

### Patch Changes

- 47cda20: Add optional `shardSubdomain` shape option to auto-shard the url subdomain in development. This solves the slow shapes in development problem without needing HTTP/2 or system level deps like Caddy or mkcert.

## 1.0.12

### Patch Changes

- d87b6ec: fix: rename the `log` property

## 1.0.11

### Patch Changes

- aa48e04: feat: add a `snapshot-end` control message to the end of snapshots
- 965ef47: feat: add support for `changes_only` mode, subset snapshots, and `offset=now`
  - `changes_only` - in this mode the server will not create initial snapshot for the shape, the clients will start receiving changes without seeing base data. Best paired with...
  - Subset snapshots - the server now accepts a `subset__*` set of parameters, which when provided result in a special-form response containing a snapshot of a subset (may be full) of a shape, and information on how to position this response in the stream. The client exposes a new method `requestSnapshot` which will make this request and then inject the response into the correct place in the subscribed messages stream, bounded with a `snapshot-end` control message.
  - `offset=now` - the server now accepts a `offset=now` special value, in which case the client will receive an immediate up-to-date response with the latest possible continuation offset, allowing it to skip all historical data and start "from scratch". This works best with `changes_only` and subset snapshots where a client doesn't keep state and upon a reload needs to start fresh without historical data.

## 1.0.10

### Patch Changes

- 9be7751: Add `transformer` function to `ShapeStreamOptions` to support transforms like camelCase keys.
- 64dcfec: Add client-side cache buster for expired shapes to prevent 409s

  When a shape 409s, the client now stores this information in localStorage and adds a `expired_handle` parameter to future requests for that shape, preventing redundant 409 responses and reducing app loading latency.

## 1.0.9

### Patch Changes

- 2c19914: Ensure 409s do not lead to infinite request cycles because of caching.

## 1.0.8

### Patch Changes

- 098e693: Export { ELECTRIC_PROTOCOL_QUERY_PARAMS } from "@electric-sql/client" for use in proxies

## 1.0.7

### Patch Changes

- 6232b7e: Fix parsing of text `"NULL"` values as text rather than `NULL`

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
