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

These compose together, e.g.:

```ts
import { ShapeStream } from '@electric-sql/client'

const stream = new ShapeStream({
  url: `http://localhost:3000/v1/shape`,
  params: {
    table: 'items'
  }
})
const shape = new Shape(stream)

// The callback runs every time the Shape data changes.
shape.subscribe(data => console.log(data))
```

### ShapeStream

The [`ShapeStream`](https://github.com/electric-sql/electric/blob/main/packages/typescript-client/src/client.ts#L163) is a low-level primitive for consuming a [Shape Log](../http#shape-log).

Construct with a shape definition and options and then either subscribe to the shape log messages directly or pass into a [`Shape`](#shape) to materialise the stream into an object.

```tsx
import { ShapeStream } from '@electric-sql/client'

// Passes subscribers rows as they're inserted, updated, or deleted
const stream = new ShapeStream({
  url: `http://localhost:3000/v1/shape`,
  params: {
    table: `foo`
  }
})

stream.subscribe(messages => {
  // messages is an array with one or more row updates
  // and the stream will wait for all subscribers to process them
  // before proceeding
})
```

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
   * Which database to use.
   * This is optional unless Electric is used with multiple databases.
   */
  databaseId?: string

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
     * The columns to include in the shape.
     * Must include primary keys, and can only include valid columns.
     */
    columns?: string[]

    /**
     * If `replica` is `default` (the default) then Electric will only send the
     * changed columns in an update.
     *
     * If it's `full` Electric will send the entire row with both changed and
     * unchanged values.
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
   * you'd pass in the last offset and shapeId you'd seen from the Electric server
   * so it knows at what point in the shape to catch you up from.
   */
  offset?: Offset

  /**
   * Similar to `offset`, this isn't typically used unless you're maintaining
   * a cache of the shape log.
   */
  shapeId?: string

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
- `database_id`

The following PostgreSQL-specific parameters should be included within the `params` object:
- `table` - The root table for the shape
- `where` - SQL where clause for filtering rows
- `columns` - List of columns to include
- `replica` - Controls whether to send full or partial row updates

Example with PostgreSQL-specific parameters:
```typescript
const stream = new ShapeStream({
  url: 'http://localhost:3000/v1/shape',
  params: {
    table: 'users',
    where: 'age > 18',
    columns: ['id', 'name', 'email'],
    replica: 'full'
  }
})
```

You can also include additional custom parameters in the `params` object alongside the PostgreSQL-specific ones:
```typescript
const stream = new ShapeStream({
  url: 'http://localhost:3000/v1/shape',
  params: {
    table: 'users',
    customParam: 'value'
  }
})
```

#### Messages

A `ShapeStream` consumes and emits a stream of messages. These messages can either be a `ChangeMessage` representing a change to the shape data:

```ts
export type ChangeMessage<T extends Row<unknown> = Row> = {
  key: string
  value: T
  headers: Header & { operation: `insert` | `update` | `delete` }
  offset: Offset
}
```

Or a `ControlMessage`, representing an instruction to the client, as [documented here](../http#control-messages).

#### Parsing

By default, when constructing a `ChangeMessage.value`, `ShapeStream` parses the following Postgres types into native JavaScript values:

- `int2`, `int4`, `float4`, and `float8` are parsed into JavaScript `Number`
- `int8` is parsed into a JavaScript `BigInt`
- `bool` is parsed into a JavaScript `Boolean`
- `json` and `jsonb` are parsed into JavaScript values/arrays/objects using `JSON.parse`
- Postgres Arrays are parsed into JavaScript arrays, e.g. <code v-pre>"{{1,2},{3,4}}"</code> is parsed into `[[1,2],[3,4]]`

All other types aren't parsed and are left in the string format as they were served by the HTTP endpoint.

##### Custom parsing

You can extend this behaviour by configuring a custom parser. This is an object mapping Postgres types to parsing functions for those types. For example, we can extend the [default parser](https://github.com/electric-sql/electric/blob/main/packages/typescript-client/src/parser.ts#L28-L37) to parse booleans into `1` or `0` instead of `true` or `false`:

```ts
const stream = new ShapeStream({
  url: `http://localhost:3000/v1/shape`,
  params: {
    table: `foo`
  },
  parser: {
    bool: (value: string) => value === `true` ? 1 : 0
  }
})
```

#### Replica full

By default Electric sends the modified columns in an update message, not the complete row. To be specific:

- an `insert` operation contains the full row
- an `update` operation contains the primary key column(s) and the changed columns
- a `delete` operation contains just the primary key column(s)

If you'd like to recieve the full row value for updates and deletes, you can set the `replica` option of your `ShapeStream` to `full`:

```tsx
import { ShapeStream } from "@electric-sql/client"

const stream = new ShapeStream({
  url: `http://localhost:3000/v1/shape`,
  params: {
    table: `foo`,
    replica: `full`
  }
})
```

This is less efficient and will use more bandwidth for the same shape (especially for tables with large static column values). Note also that shapes with different `replica` settings are distinct, even for the same table and where clause combination.

#### Custom error handler

You can provide a custom error handler to recover from 4xx HTTP errors. 
Using a custom error handler we can for instance refresh the authorization token when a request is rejected with a `401 Unauthorized` status code because the token expired:

```ts
const stream = new ShapeStream({
  url: 'http://localhost:3000/v1/shape',
  params: {
    table: 'items'
  },
  // Add authentication header
  headers: {
    'Authorization': 'Bearer token'
  },
  // Add custom URL parameters
  onError: async (error) => {
    if (error instanceof FetchError && error.status === 401) {
      const token = await getToken()
      return {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    }
    // Rethrow errors we can't handle
    throw error
  }
})
```

### Shape

The [`Shape`](https://github.com/electric-sql/electric/blob/main/packages/typescript-client/src/shape.ts) is the main primitive for working with synced data.

It takes a [`ShapeStream`](#shapestream), consumes the stream, materialises it into a Shape object and notifies you when this changes.

```tsx
import { ShapeStream, Shape } from '@electric-sql/client'

const stream = new ShapeStream({
  url: `http://localhost:3000/v1/shape`,
  params: {
    table: `foo`
  }
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
    table: 'issues'
  }
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
const unsubscribe = stream.subscribe(messages => {
  console.log('Received messages:', messages)
})

// Later, unsubscribe this specific subscription
unsubscribe()

// Or unsubscribe all subscriptions
stream.unsubscribeAll()
```

### Error Handling

The ShapeStream provides two ways to handle errors:

1. Using the `onError` handler (recommended):
```typescript
const stream = new ShapeStream({
  url: 'http://localhost:3000/v1/shape',
  params: {
    table: 'issues'
  },
  onError: (error) => {
    // Handle all stream errors here
    if (error instanceof FetchError) {
      console.error('HTTP error:', error.status, error.message)
    } else {
      console.error('Stream error:', error)
    }
  }
})
```

If no `onError` handler is provided, the ShapeStream will throw errors that occur during streaming.

2. Individual subscribers can optionally handle errors specific to their subscription:
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

#### Error Types

The following error types may be encountered:

**Initialization Errors** (thrown by constructor):
- `MissingShapeUrlError`: Missing required URL parameter
- `InvalidSignalError`: Invalid AbortSignal instance
- `ReservedParamError`: Using reserved parameter names

**Runtime Errors** (handled by `onError` or thrown):
- `FetchError`: HTTP errors during shape fetching
- `FetchBackoffAbortError`: Fetch aborted using AbortSignal
- `MissingShapeHandleError`: Missing required shape handle
- `ParserNullValueError`: Parser encountered NULL value in a column that doesn't allow NULL values

See the [Examples](https://github.com/electric-sql/electric/tree/main/examples) and [integrations](/docs/integrations/react) for more usage examples.
