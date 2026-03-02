---
name: shape-options-reference
parent: electric-shapes
---

# ShapeStream Options Reference

## Constructor Options

| Option           | Type                                                          | Required | Description                                                |
| ---------------- | ------------------------------------------------------------- | -------- | ---------------------------------------------------------- |
| `url`            | `string`                                                      | Yes      | Proxy endpoint URL                                         |
| `headers`        | `Record<string, string \| (() => string \| Promise<string>)>` | No       | Request headers (can be async functions for token refresh) |
| `params`         | `Record<string, string>`                                      | No       | Additional URL search params                               |
| `parser`         | `Record<string, (value: string) => any>`                      | No       | Type parsers for Postgres types                            |
| `fetchClient`    | `typeof fetch`                                                | No       | Custom fetch implementation                                |
| `onError`        | `(error: Error) => Promise<void \| { headers?, params? }>`    | No       | Error handler (return to retry, void to stop)              |
| `backoffOptions` | `BackoffOptions`                                              | No       | Exponential backoff config                                 |
| `signal`         | `AbortSignal`                                                 | No       | Abort signal for cancellation                              |
| `subscribe`      | `boolean`                                                     | No       | Auto-subscribe to changes (default: true)                  |

## Server-Side URL Parameters (set in proxy)

| Parameter   | Required   | Description                                    |
| ----------- | ---------- | ---------------------------------------------- |
| `table`     | Yes        | Table name (e.g., `todos` or `public.todos`)   |
| `where`     | No         | SQL WHERE clause filter                        |
| `columns`   | No         | Comma-separated column list (must include PK)  |
| `params`    | No         | JSON array for WHERE placeholders (`$1`, `$2`) |
| `source_id` | Cloud only | Electric Cloud source identifier               |
| `secret`    | Cloud only | Electric Cloud secret (server-side only)       |

## Protocol Parameters (forwarded by proxy)

These are in the `ELECTRIC_PROTOCOL_QUERY_PARAMS` constant:

| Parameter | Description                               |
| --------- | ----------------------------------------- |
| `offset`  | Position in shape log (`-1` for start)    |
| `handle`  | Shape identifier from initial response    |
| `live`    | Enable long-polling for real-time updates |
| `cursor`  | Cursor for pagination                     |

## BackoffOptions

| Option         | Type     | Default | Description         |
| -------------- | -------- | ------- | ------------------- |
| `initialDelay` | `number` | 100     | Initial delay in ms |
| `maxDelay`     | `number` | 10000   | Maximum delay in ms |
| `multiplier`   | `number` | 1.3     | Backoff multiplier  |

## Shape Methods

| Method                   | Returns          | Description                               |
| ------------------------ | ---------------- | ----------------------------------------- |
| `shape.rows`             | `Promise<Row[]>` | All rows (resolves when caught up)        |
| `shape.currentRows`      | `Row[]`          | Current rows synchronously                |
| `shape.isUpToDate()`     | `boolean`        | Whether shape is caught up                |
| `shape.subscribe(cb)`    | `() => void`     | Subscribe to changes, returns unsubscribe |
| `shape.unsubscribeAll()` | `void`           | Remove all subscribers                    |

## ShapeStream Methods

| Method                 | Returns               | Description               |
| ---------------------- | --------------------- | ------------------------- |
| `stream.subscribe(cb)` | `() => void`          | Subscribe to raw messages |
| `stream.isConnected()` | `boolean`             | Connection status         |
| `stream.lastOffset`    | `Offset`              | Last seen offset          |
| `stream.shapeHandle`   | `string \| undefined` | Current shape handle      |
