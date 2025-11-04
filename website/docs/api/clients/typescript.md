---
title: Typescript Client
description: >-
  Electric provides an Typescript client for streaming Shapes from Postgres
  into the web browser and other Javascript environments.
image: /img/integrations/electric-typescript.jpg
outline: [2, 4]
---

# TypeScript client

The TypeScript client is a higher-level client interface that wraps the [HTTP API](/docs/api/http) to make it easy to sync [Shapes](/docs/guides/shapes) in the web browser and other JavaScript environments.

Defined in [packages/typescript-client](https://github.com/electric-sql/electric/tree/main/packages/typescript-client), it provides a [ShapeStream](#shapestream) primitive to subscribe to a change stream and a [Shape](#shape) primitive to get the whole shape whenever it changes.

## Install

The client is published on NPM as [`@electric-sql/client`](https://www.npmjs.com/package/@electric-sql/client):

```sh
npm i @electric-sql/client
```

## How to use

The client exports:

- a [`ShapeStream`](#shapestream) class for consuming a [Shape Log](../http#shape-log); and
- a [`Shape`](#shape) class for materialising the log stream into a shape object

### Best Practice: Use API Endpoints, Not Direct Access

:::tip Recommended Pattern
While the Electric client can connect directly to the Electric service, **we strongly recommend proxying requests through your backend API** for production applications. This pattern treats Electric shapes like normal API calls, providing better security, maintainability, and developer experience.
:::

#### Recommended: API Proxy Pattern

```ts
// Client code - Clean API pattern
import { ShapeStream, Shape } from '@electric-sql/client'

const stream = new ShapeStream({
  url: `http://localhost:3001/api/items`, // Your API endpoint
  // No table or SQL exposed to client
})
const shape = new Shape(stream)
shape.subscribe((data) => console.log(data))
```

```ts
// Server code - Handles Electric details
import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from '@electric-sql/client'

app.get('/api/items', async (req, res) => {
  const electricUrl = new URL('http://localhost:3000/v1/shape')

  // Forward only Electric protocol parameters
  ELECTRIC_PROTOCOL_QUERY_PARAMS.forEach((param) => {
    if (req.query[param]) {
      electricUrl.searchParams.set(param, req.query[param])
    }
  })

  // Server controls table and authorization
  electricUrl.searchParams.set('table', 'items')
  electricUrl.searchParams.set('where', `user_id = '${req.user.id}'`)

  // Proxy response with streaming...
  const response = await fetch(electricUrl)
  // Handle streaming (see auth guide for full example)
})
```

This pattern provides:

- **Security**: Credentials and table names never exposed to clients
- **Authorization**: Server controls data access with WHERE clauses
- **Type Safety**: Backend validates all operations
- **Maintainability**: Database changes don't affect client code
- **Familiarity**: Works like standard REST/GraphQL APIs

**→ See the [authentication guide](/docs/guides/auth) for a detailed explanation and complete implementation examples of the API proxy pattern.**

#### Direct Connection (Development Only)

For development or examples, you can connect directly:

```ts
import { ShapeStream, Shape } from '@electric-sql/client'

const stream = new ShapeStream({
  url: `http://localhost:3000/v1/shape`,
  params: {
    table: 'items',
  },
})
const shape = new Shape(stream)
shape.subscribe((data) => console.log(data))
```

:::warning
Direct connections expose database structure and should only be used for development or trusted environments.
:::

### ShapeStream

The [`ShapeStream`](https://github.com/electric-sql/electric/blob/main/packages/typescript-client/src/client.ts#L163) is a low-level primitive for consuming a [Shape Log](../http#shape-log).

Construct with a shape definition and options and then either subscribe to the shape log messages directly or pass into a [`Shape`](#shape) to materialise the stream into an object.

```tsx
import { ShapeStream } from '@electric-sql/client'

// Passes subscribers rows as they're inserted, updated, or deleted
const stream = new ShapeStream({
  url: `http://localhost:3000/v1/shape`,
  params: {
    table: `foo`,
  },
})

stream.subscribe((messages) => {
  // messages is an array with one or more row updates
  // and the stream will wait for all subscribers to process them
  // before proceeding
})
```

#### Using Server-Sent Events (SSE)

Electric supports Server-Sent Events (SSE) for more efficient live updates. Instead of making repeated long-polling requests, SSE uses a persistent connection that allows the server to push updates as they happen:

```tsx
import { ShapeStream } from '@electric-sql/client'

const stream = new ShapeStream({
  url: `http://localhost:3000/v1/shape`,
  params: {
    table: `foo`,
  },
  liveSse: true, // Enable SSE for live updates
})

stream.subscribe((messages) => {
  // Receive real-time updates via SSE
})
```

**Benefits of SSE:**
- Single persistent connection for all live updates
- Lower latency (server pushes changes immediately)
- Reduced bandwidth (no request overhead per update)
- More efficient for frequent updates

**Automatic Fallback:**

The client automatically detects when SSE is not working properly (e.g., due to proxy buffering) and falls back to long polling. This happens when:
1. SSE connections close immediately (< 1 second)
2. This occurs 3 times consecutively
3. The client logs a warning and switches to long polling

If your reverse proxy or CDN is buffering responses, you may need to configure it to support streaming. See the [HTTP API SSE documentation](/docs/api/http#server-sent-events-sse) for proxy configuration examples.

#### Options

The `ShapeStream` constructor takes [the following options](https://github.com/electric-sql/electric/blob/main/packages/typescript-client/src/client.ts#L39):

```ts
/**
 * Options for constructing a ShapeStream.
 */
export interface ShapeStreamOptions<T = never> {
  /**
   * The full URL to where the Shape is hosted. This can either be the Electric
   * server directly or a proxy. E.g. for a local Electric instance, you might
   * set `http://localhost:3000/v1/shape`
   */
  url: string

  /**
   * PostgreSQL-specific parameters for the shape.
   * This includes table, where clause, columns, and replica settings.
   */
  params: {
    /**
     * The root table for the shape.
     */
    table: string

    /**
     * The where clauses for the shape.
     */
    where?: string

    /**
     * Positional where clause paramater values. These will be passed to the server
     * and will substitute `$i` parameters in the where clause.
     *
     * It can be an array (note that positional arguments start at 1, the array will be mapped
     * accordingly), or an object with keys matching the used positional parameters in the where clause.
     *
     * If where clause is `id = $1 or id = $2`, params must have keys `"1"` and `"2"`, or be an array with length 2.
     */
    params?: Record<`${number}`, string> | string[]

    /**
     * The columns to include in the shape.
     * Must include primary keys, and can only include valid columns.
     */
    columns?: string[]

    /**
     * If `replica` is `default` (the default) then Electric will only send the
     * changed columns in an update.
     *
     * If it's `full` Electric will send the entire row with both changed and
     * unchanged values. `old_value` will also be present on update messages,
     * containing the previous value for changed columns.
     *
     * Setting `replica` to `full` will obviously result in higher bandwidth
     * usage and so is not recommended.
     */
    replica?: Replica

    /**
     * Additional request parameters to attach to the URL.
     * These will be merged with Electric's standard parameters.
     */
    [key: string]: string | string[] | undefined
  }

  /**
   * The "offset" on the shape log. This is typically not set as the ShapeStream
   * will handle this automatically. A common scenario where you might pass an offset
   * is if you're maintaining a local cache of the log. If you've gone offline
   * and are re-starting a ShapeStream to catch-up to the latest state of the Shape,
   * you'd pass in the last offset and shapeHandle you'd seen from the Electric server
   * so it knows at what point in the shape to catch you up from.
   */
  offset?: Offset

  /**
   * Similar to `offset`, this isn't typically used unless you're maintaining
   * a cache of the shape log.
   */
  shapeHandle?: string

  /**
   * HTTP headers to attach to requests made by the client.
   * Can be used for adding authentication headers.
   */
  headers?: Record<string, string>

  /**
   * Automatically fetch updates to the Shape. If you just want to sync the current
   * shape and stop, pass false.
   */
  subscribe?: boolean

  /**
   * Initial data loading mode. Controls how data is loaded into the shape log.
   *
   * When `log` is `full` (the default), the server creates an initial snapshot
   * of all data matching the shape definition before delivering real-time updates.
   *
   * When `log` is `changes_only`, the server skips the initial snapshot creation.
   * The client will only receive changes that occur after the shape is established,
   * without seeing the base data. In this mode, you can use `requestSnapshot()` to
   * fetch subsets of data on-demand.
   */
  log?: 'full' | 'changes_only'

  /**
   * Use Server-Sent Events (SSE) for live updates instead of long polling.
   *
   * When enabled, the client uses a persistent SSE connection to receive real-time
   * updates, which is more efficient than long polling (single connection vs many requests).
   *
   * The client automatically falls back to long polling if SSE connections are failing
   * (e.g., due to proxy buffering or misconfiguration). This happens after 3 consecutive
   * quick-close attempts (connections lasting less than 1 second).
   *
   * Default: false (uses long polling)
   */
  liveSse?: boolean

  /**
   * @deprecated Use `liveSse` instead. Will be removed in a future version.
   */
  experimentalLiveSse?: boolean

  /**
   * Signal to abort the stream.
   */
  signal?: AbortSignal

  /**
   * Custom fetch client implementation.
   */
  fetchClient?: typeof fetch

  /**
   * Custom parser for handling specific Postgres data types.
   */
  parser?: Parser<T>

  /**
   * A function to transform the Message value before emitting to subscribers.
   * This can be used to camelCase keys or rename fields.
   */
  transformer?: TransformFunction<T>

  /**
   * A function for handling errors.
   * This is optional, when it is not provided any shapestream errors will be thrown.
   * If the function returns an object containing parameters and/or headers
   * the shapestream will apply those changes and try syncing again.
   * If the function returns void the shapestream is stopped.
   */
  onError?: ShapeStreamErrorHandler

  backoffOptions?: BackoffOptions
}

type RetryOpts = {
  params?: ParamsRecord
  headers?: Record<string, string>
}

type ShapeStreamErrorHandler = (
  error: Error
) => void | RetryOpts | Promise<void | RetryOpts>
```

Note that certain parameter names are reserved for Electric's internal use and cannot be used in custom params:

- `offset`
- `handle`
- `live`
- `cursor`
- `source_id`

The following PostgreSQL-specific parameters should be included within the `params` object:

- `table` - The root table for the shape
- `where` - SQL where clause for filtering rows
- `params` - Values for positional parameters in the where clause (e.g. `$1`)
- `columns` - List of columns to include
- `replica` - Controls whether to send full or partial row updates

Example with PostgreSQL-specific parameters:

```typescript
const stream = new ShapeStream({
  url: 'http://localhost:3000/v1/shape',
  params: {
    table: 'users',
    where: 'age > $1',
    columns: ['id', 'name', 'email'],
    params: ['18'],
    replica: 'full',
  },
})
```

You can also include additional custom parameters in the `params` object alongside the PostgreSQL-specific ones:

```typescript
const stream = new ShapeStream({
  url: 'http://localhost:3000/v1/shape',
  params: {
    table: 'users',
    customParam: 'value',
  },
})
```

#### Dynamic Options

Both `params` and `headers` support function options that are resolved when needed. These functions can be synchronous or asynchronous:

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
    'X-Tenant-Id': () => getCurrentTenant(),
  },
})
```

Function options are resolved in parallel, making this pattern efficient for multiple async operations like fetching auth tokens and user context. Common use cases include:

- Authentication tokens that need to be refreshed
- User-specific parameters that may change
- Dynamic filtering based on current state
- Multi-tenant applications where context determines the request

#### Messages

A `ShapeStream` consumes and emits a stream of messages. These messages can either be a `ChangeMessage` representing a change to the shape data:

```ts
export type ChangeMessage<T extends Row<unknown> = Row> = {
  key: string
  value: T
  old_value?: Partial<T> // Only provided for updates if `replica` is `full`
  headers: Header & { operation: `insert` | `update` | `delete` }
}
```

Or a `ControlMessage`, representing an instruction to the client:

```ts
export type ControlMessage = {
  headers:
    | (Header & {
        control: `up-to-date` | `must-refetch`
        global_last_seen_lsn?: string
      })
    | (Header & { control: `snapshot-end` } & PostgresSnapshot)
}
```

Control messages include:

- `up-to-date` - Indicates the client has received all available data
- `must-refetch` - Indicates the client must discard local data and re-sync from scratch
- `snapshot-end` - Marks the end of a subset snapshot, includes PostgreSQL snapshot metadata (xmin, xmax, xip_list) for tracking which changes to skip

See the [HTTP API control messages documentation](../http#control-messages) for more details.

#### Parsing and Custom Parsing

To understand the type of each column in your shape, you can check the `electric-schema` response header in the shape response. This header contains the PostgreSQL type information for each column.

By default, when constructing a `ChangeMessage.value`, `ShapeStream` parses the following Postgres types into native JavaScript values:

- `int2`, `int4`, `float4`, and `float8` are parsed into JavaScript `Number`
- `int8` is parsed into a JavaScript `BigInt`
- `bool` is parsed into a JavaScript `Boolean`
- `json` and `jsonb` are parsed into JavaScript values/arrays/objects using `JSON.parse`
- Postgres Arrays are parsed into JavaScript arrays, e.g. <code v-pre>"{{1,2},{3,4}}"</code> is parsed into `[[1,2],[3,4]]`

All other types aren't parsed and are left in the string format as they were served by the HTTP endpoint.

You can extend the default parsing behavior by defining custom parsers for specific PostgreSQL data types. This is particularly useful when you want to transform string representations of dates, JSON, or other complex types into their corresponding JavaScript objects. Here's an example:

```ts
// Define row type
type CustomRow = {
  id: number
  title: string
  created_at: Date // We want this to be a Date object
}

const stream = new ShapeStream<CustomRow>({
  url: 'http://localhost:3000/v1/shape',
  params: {
    table: 'posts',
  },
  parser: {
    // Parse timestamp columns into JavaScript Date objects
    timestamptz: (date: string) => new Date(date),
  },
})

const shape = new Shape(stream)
shape.subscribe((data) => {
  console.log(data.created_at instanceof Date) // true
})
```

**Transformer**

While the parser operates on individual fields, the transformer allows you to modify the entire record after the parser has run.

This can be used to convert field names to camelCase or rename fields.

```ts
type CustomRow = {
  id: number
  postTitle: string // post_title in database
  createdAt: Date // created_at in database
}

// transformer example: camelCaseKeys
const toCamelCase = (str: string) =>
  str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())

const camelCaseKeys: TransformFunction = (row) =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [toCamelCase(k), v]))

const stream = new ShapeStream<CustomRow>({
  url: 'http://localhost:3000/v1/shape',
  params: {
    table: 'posts',
  },
  transformer: camelCaseKeys,
})

const shape = new Shape(stream)
shape.subscribe((data) => {
  console.log(Object.keys(data)) // [id, postTitle, createdAt]
})
```

#### Replica full

By default Electric sends the modified columns in an update message, not the complete row. To be specific:

- an `insert` operation contains the full row
- an `update` operation contains the primary key column(s) and the changed columns
- a `delete` operation contains just the primary key column(s)

If you'd like to receive the full row value for updates and deletes, you can set the `replica` option of your `ShapeStream` to `full`:

```tsx
import { ShapeStream } from '@electric-sql/client'

const stream = new ShapeStream({
  url: `http://localhost:3000/v1/shape`,
  params: {
    table: `foo`,
    replica: `full`,
  },
})
```

When using `replica=full`, the returned rows will include:

- on `insert` the new value in `msg.value`
- on `update` the new value in `msg.value` and the previous value in `msg.old_value` for any changed columns - the full previous state can be reconstructed by combining the two
- on `delete` the full previous value in `msg.value`

This is less efficient and will use more bandwidth for the same shape (especially for tables with large static column values). Note also that shapes with different `replica` settings are distinct, even for the same table and where clause combination.

#### Authentication

For authentication patterns including token refresh and authorization, see the [authentication guide](/docs/guides/auth) which covers both proxy and gatekeeper authentication patterns in detail.

### Shape

The [`Shape`](https://github.com/electric-sql/electric/blob/main/packages/typescript-client/src/shape.ts) is the main primitive for working with synced data.

It takes a [`ShapeStream`](#shapestream), consumes the stream, materialises it into a Shape object and notifies you when this changes.

```tsx
import { ShapeStream, Shape } from '@electric-sql/client'

const stream = new ShapeStream({
  url: `http://localhost:3000/v1/shape`,
  params: {
    table: `foo`,
  },
})
const shape = new Shape(stream)

// Returns promise that resolves with the latest shape data once it's fully loaded
await shape.rows

// passes subscribers shape data when the shape updates
shape.subscribe(({ rows }) => {
  // rows is an array of the latest value of each row in a shape.
})
```

### Subscribing to updates

The `subscribe` method allows you to receive updates whenever the shape changes. It takes two arguments:

1. A message handler callback (required)
2. An error handler callback (optional)

```typescript
const stream = new ShapeStream({
  url: 'http://localhost:3000/v1/shape',
  params: {
    table: 'issues',
  },
})

// Subscribe to both message and error handlers
stream.subscribe(
  (messages) => {
    // Process messages
    console.log('Received messages:', messages)
  },
  (error) => {
    // Get notified about errors
    console.error('Error in subscription:', error)
  }
)
```

You can have multiple active subscriptions to the same stream. Each subscription will receive the same messages, and the stream will wait for all subscribers to process their messages before proceeding.

To stop receiving updates, you can either:

- Unsubscribe a specific subscription using the function returned by `subscribe`
- Unsubscribe all subscriptions using `unsubscribeAll()`

```typescript
// Store the unsubscribe function
const unsubscribe = stream.subscribe((messages) => {
  console.log('Received messages:', messages)
})

// Later, unsubscribe this specific subscription
unsubscribe()

// Or unsubscribe all subscriptions
stream.unsubscribeAll()
```

### Error Handling

The ShapeStream provides robust error handling with automatic retry support through the `onError` callback.

#### The `onError` Callback

The `onError` option provides powerful error recovery with automatic retry support:

```typescript
onError?: ShapeStreamErrorHandler

type ShapeStreamErrorHandler = (
  error: Error
) => void | RetryOpts | Promise<void | RetryOpts>

type RetryOpts = {
  params?: ParamsRecord
  headers?: Record<string, string>
}
```

#### Return Value Behavior

The return value from `onError` controls whether syncing continues:

| Return Value | Behavior |
|--------------|----------|
| `{}` (empty object) | Retry syncing with the same params and headers |
| `{ params }` | Retry syncing with modified params |
| `{ headers }` | Retry syncing with modified headers |
| `{ params, headers }` | Retry syncing with both modified |
| `void` or `undefined` | **Stop syncing permanently** |

**Critical**: If you want syncing to continue after an error, you **must** return at least an empty object `{}`. Simply logging the error and returning nothing will stop syncing.

**Automatic retries**: The client automatically retries 5xx server errors, network errors, and 429 rate limits with exponential backoff (configurable via `backoffOptions`). The `onError` callback is only invoked after these automatic retries are exhausted, or for non-retryable errors like 4xx client errors.

**Without `onError`**: If no error handler is provided, non-retryable errors (like 4xx client errors) will be thrown and the stream will stop.

#### Examples

**Handle client errors with retry:**

```typescript
const stream = new ShapeStream({
  url: 'http://localhost:3000/v1/shape',
  params: { table: 'items' },
  onError: (error) => {
    console.error('Stream error:', error)

    // Note: 5xx errors are automatically retried by the client
    // onError is mainly for handling 4xx client errors

    if (error instanceof FetchError && error.status === 400) {
      // Bad request - maybe retry with different params
      return {
        params: { table: 'items', where: 'id > 0' }
      }
    }

    // Stop on other errors (return void)
  }
})
```

**Refresh authentication token:**

```typescript
const stream = new ShapeStream({
  url: 'http://localhost:3000/v1/shape',
  params: { table: 'items' },
  headers: {
    Authorization: `Bearer ${initialToken}`
  },
  onError: async (error) => {
    if (error instanceof FetchError && error.status === 401) {
      // Refresh the token asynchronously
      const newToken = await refreshAuthToken()

      return {
        headers: {
          Authorization: `Bearer ${newToken}`
        }
      }
    }

    // Retry other errors with same params
    return {}
  }
})
```

**Update query parameters:**

```typescript
const stream = new ShapeStream({
  url: 'http://localhost:3000/v1/shape',
  params: {
    table: 'items',
    where: 'user_id = $1',
    params: [currentUserId]
  },
  onError: (error) => {
    if (error instanceof FetchError && error.status === 403) {
      // Access denied - maybe switch to a different user context
      return {
        params: {
          table: 'items',
          where: 'user_id = $1',
          params: [fallbackUserId]
        }
      }
    }

    return {} // Retry other errors
  }
})
```

**Selective retry logic for client errors:**

```typescript
let retryCount = 0

const stream = new ShapeStream({
  url: 'http://localhost:3000/v1/shape',
  params: { table: 'items' },
  onError: (error) => {
    console.error('Stream error:', error)

    // Note: This callback is invoked AFTER automatic retries for 5xx errors
    // So if you see a 5xx here, the exponential backoff has been exhausted

    if (error instanceof FetchError) {
      // 401 - Try to refresh auth token once
      if (error.status === 401 && retryCount === 0) {
        retryCount++
        return { headers: { Authorization: getNewToken() } }
      }

      // 400 - Bad request, maybe our params are wrong
      if (error.status === 400) {
        console.error('Bad request, stopping stream')
        return // Stop
      }

      // Other 4xx errors - stop
      if (error.status >= 400 && error.status < 500) {
        return // Stop
      }
    }

    // For non-HTTP errors or exhausted 5xx retries, stop
    return // Stop
  }
})
```

#### Subscription-Level Error Callbacks

Individual subscribers can also handle errors specific to their subscription:

```typescript
stream.subscribe(
  (messages) => {
    // Process messages
  },
  (error) => {
    // Handle errors for this specific subscription
    console.error('Subscription error:', error)
  }
)
```

Note: Subscription error callbacks cannot control retry behavior - use the stream-level `onError` for that.

#### Error Types

All Electric errors extend the base `Error` class:

**Initialization Errors** (thrown by constructor):

- `MissingShapeUrlError`: Missing required URL parameter
- `InvalidSignalError`: Invalid AbortSignal instance
- `ReservedParamError`: Using reserved parameter names

**Runtime Errors** (handled by `onError` or thrown):

- **`FetchError`**: HTTP request failed
  - Properties: `status`, `text`, `json`, `headers`, `url`
  - Use this to check HTTP status codes and implement retry logic

- **`FetchBackoffAbortError`**: Request aborted by backoff logic
  - Thrown when using `AbortSignal` to cancel requests

- **`MissingShapeHandleError`**: Shape handle required when offset > -1

- **`ParserNullValueError`**: NULL value in a column that doesn't allow NULL

- **`MissingHeadersError`**: Response missing required headers

Import error types from the package:

```typescript
import { FetchError, FetchBackoffAbortError } from '@electric-sql/client'
```

### Changes-only mode and subset snapshots

Electric supports two log modes for syncing shapes. The default `full` mode creates an initial snapshot and then delivers real-time updates. The `changes_only` mode skips the initial snapshot:

```typescript
const stream = new ShapeStream({
  url: 'http://localhost:3000/v1/shape',
  params: {
    table: 'items',
  },
  log: 'changes_only', // Skip initial snapshot
})
```

In `changes_only` log mode, the client only receives changes that occur after the shape is established. This is useful for:

- Places where historical data isn't needed
- Applications that fetch their initial state through other means
- Reducing initial sync time when you don't need the complete dataset

Subset snapshots allow users to have a narrower view of data than the entire shape, enabling advanced progressive or dynamic data loading strategies. It helps avoid loading large data sets to the client on startup, especially for rarely changing data that's needed for references (e.g. loading only explicitly mentioned users)

#### Starting from 'now'

You can use `offset: 'now'` to skip all historical data and start from the current point:

```typescript
const stream = new ShapeStream({
  url: 'http://localhost:3000/v1/shape',
  params: {
    table: 'items',
  },
  offset: 'now', // Start from current point, skip all history
  log: 'changes_only',
})
```

This immediately provides an up-to-date message with the latest continuation offset, allowing applications to start fresh without processing any historical data.

#### Requesting subset snapshots

In `changes_only` mode, you can request snapshots of specific subsets of data on-demand using the `requestSnapshot()` method:

```typescript
const stream = new ShapeStream({
  url: 'http://localhost:3000/v1/shape',
  params: {
    table: 'items',
  },
  log: 'changes_only',
})

// Request a subset of data with filtering and pagination
const { metadata, data } = await stream.requestSnapshot({
  where: "priority = 'high'",
  params: { '1': 'high' },
  orderBy: 'created_at DESC',
  limit: 20,
  offset: 0,
})

// The snapshot data is automatically injected into the message stream
// with proper change tracking
```

The `requestSnapshot` method accepts the following parameters:

- `where` (optional) - WHERE clause to filter the subset
- `params` (optional) - Parameters for the WHERE clause
- `orderBy` (required when using limit/offset) - ORDER BY clause
- `limit` (optional) - Maximum number of rows to return
- `offset` (optional) - Number of rows to skip for pagination

The method returns a promise with:

- `metadata` - PostgreSQL snapshot metadata (xmin, xmax, xip_list, snapshot_mark, database_lsn)
- `data` - Array of change messages for the requested subset

The snapshot data is automatically injected into the subscribed message stream with proper change tracking. The client uses the snapshot metadata to filter out changes that were already incorporated into the snapshot, preventing duplicates.

A `snapshot-end` control message is added after the snapshot data to mark its boundary:

```typescript
{
  headers: {
    control: "snapshot-end",
    xmin: "1234",
    xmax: "1240",
    xip_list: ["1235", "1237"],
    snapshot_mark: 42,
    database_lsn: "0/12345678"
  }
}
```

See the [Demos](/demos) and [integrations](/docs/integrations/react) for more usage examples.
