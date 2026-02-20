import {
  Message,
  Offset,
  Schema,
  Row,
  MaybePromise,
  GetExtensions,
  ChangeMessage,
  SnapshotMetadata,
  SubsetParams,
} from './types'
import { MessageParser, Parser, TransformFunction } from './parser'
import {
  ColumnMapper,
  encodeWhereClause,
  quoteIdentifier,
} from './column-mapper'
import {
  getOffset,
  isUpToDateMessage,
  isChangeMessage,
  bigintSafeStringify,
} from './helpers'
import {
  FetchError,
  FetchBackoffAbortError,
  MissingShapeUrlError,
  InvalidSignalError,
  MissingShapeHandleError,
  ReservedParamError,
  MissingHeadersError,
  StaleCacheError,
} from './error'
import {
  BackoffDefaults,
  BackoffOptions,
  createFetchWithBackoff,
  createFetchWithChunkBuffer,
  createFetchWithConsumedMessages,
  createFetchWithResponseHeadersCheck,
} from './fetch'
import {
  CHUNK_LAST_OFFSET_HEADER,
  LIVE_CACHE_BUSTER_HEADER,
  LIVE_CACHE_BUSTER_QUERY_PARAM,
  EXPIRED_HANDLE_QUERY_PARAM,
  COLUMNS_QUERY_PARAM,
  LIVE_QUERY_PARAM,
  OFFSET_QUERY_PARAM,
  SHAPE_HANDLE_HEADER,
  SHAPE_HANDLE_QUERY_PARAM,
  SHAPE_SCHEMA_HEADER,
  WHERE_QUERY_PARAM,
  WHERE_PARAMS_PARAM,
  TABLE_QUERY_PARAM,
  REPLICA_PARAM,
  FORCE_DISCONNECT_AND_REFRESH,
  PAUSE_STREAM,
  SYSTEM_WAKE,
  EXPERIMENTAL_LIVE_SSE_QUERY_PARAM,
  LIVE_SSE_QUERY_PARAM,
  ELECTRIC_PROTOCOL_QUERY_PARAMS,
  LOG_MODE_QUERY_PARAM,
  SUBSET_PARAM_WHERE,
  SUBSET_PARAM_WHERE_PARAMS,
  SUBSET_PARAM_LIMIT,
  SUBSET_PARAM_OFFSET,
  SUBSET_PARAM_ORDER_BY,
  SUBSET_PARAM_WHERE_EXPR,
  SUBSET_PARAM_ORDER_BY_EXPR,
  CACHE_BUSTER_QUERY_PARAM,
} from './constants'
import { compileExpression, compileOrderBy } from './expression-compiler'
import {
  EventSourceMessage,
  fetchEventSource,
} from '@microsoft/fetch-event-source'
import { expiredShapesCache } from './expired-shapes-cache'
import { upToDateTracker } from './up-to-date-tracker'
import { SnapshotTracker } from './snapshot-tracker'
import {
  createInitialState,
  ErrorState,
  PausedState,
  ShapeStreamState,
} from './shape-stream-state'
import { PauseLock } from './pause-lock'

const RESERVED_PARAMS: Set<ReservedParamKeys> = new Set([
  LIVE_CACHE_BUSTER_QUERY_PARAM,
  SHAPE_HANDLE_QUERY_PARAM,
  LIVE_QUERY_PARAM,
  OFFSET_QUERY_PARAM,
  CACHE_BUSTER_QUERY_PARAM,
])

const TROUBLESHOOTING_URL = `https://electric-sql.com/docs/guides/troubleshooting`

type Replica = `full` | `default`
export type LogMode = `changes_only` | `full`

/**
 * PostgreSQL-specific shape parameters that can be provided externally
 */
export interface PostgresParams<T extends Row<unknown> = Row> {
  /** The root table for the shape. Not required if you set the table in your proxy. */
  table?: string

  /**
   * The columns to include in the shape.
   * Must include primary keys, and can only include valid columns.
   * Defaults to all columns of the type `T`. If provided, must include primary keys, and can only include valid columns.

   */
  columns?: (keyof T)[]

  /** The where clauses for the shape */
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
   * If `replica` is `default` (the default) then Electric will only send the
   * changed columns in an update.
   *
   * If it's `full` Electric will send the entire row with both changed and
   * unchanged values. `old_value` will also be present on update messages,
   * containing the previous value for changed columns.
   *
   * Setting `replica` to `full` will result in higher bandwidth
   * usage and so is not generally recommended.
   */
  replica?: Replica
}
type SerializableParamValue = string | string[] | Record<string, string>
type ParamValue =
  | SerializableParamValue
  | (() => SerializableParamValue | Promise<SerializableParamValue>)

/**
 * External params type - what users provide.
 * Excludes reserved parameters to prevent dynamic variations that could cause stream shape changes.
 */
export type ExternalParamsRecord<T extends Row<unknown> = Row> = {
  [K in string]: ParamValue | undefined
} & Partial<PostgresParams<T>> & { [K in ReservedParamKeys]?: never }

type ReservedParamKeys =
  | typeof LIVE_CACHE_BUSTER_QUERY_PARAM
  | typeof SHAPE_HANDLE_QUERY_PARAM
  | typeof LIVE_QUERY_PARAM
  | typeof OFFSET_QUERY_PARAM
  | typeof CACHE_BUSTER_QUERY_PARAM
  | `subset__${string}`

/**
 * External headers type - what users provide.
 * Allows string or function values for any header.
 */
export type ExternalHeadersRecord = {
  [key: string]: string | (() => string | Promise<string>)
}

/**
 * Internal params type - used within the library.
 * All values are converted to strings.
 */
type InternalParamsRecord = {
  [K in string as K extends ReservedParamKeys ? never : K]:
    | string
    | Record<string, string>
}

/**
 * Helper function to resolve a function or value to its final value
 */
export async function resolveValue<T>(
  value: T | (() => T | Promise<T>)
): Promise<T> {
  if (typeof value === `function`) {
    return (value as () => T | Promise<T>)()
  }
  return value
}

/**
 * Helper function to convert external params to internal format
 */
async function toInternalParams(
  params: ExternalParamsRecord<Row>
): Promise<InternalParamsRecord> {
  const entries = Object.entries(params)
  const resolvedEntries = await Promise.all(
    entries.map(async ([key, value]) => {
      if (value === undefined) return [key, undefined]
      const resolvedValue = await resolveValue(value)
      return [
        key,
        Array.isArray(resolvedValue) ? resolvedValue.join(`,`) : resolvedValue,
      ]
    })
  )

  return Object.fromEntries(
    resolvedEntries.filter(([_, value]) => value !== undefined)
  )
}

/**
 * Helper function to resolve headers
 */
async function resolveHeaders(
  headers?: ExternalHeadersRecord
): Promise<Record<string, string>> {
  if (!headers) return {}

  const entries = Object.entries(headers)
  const resolvedEntries = await Promise.all(
    entries.map(async ([key, value]) => [key, await resolveValue(value)])
  )

  return Object.fromEntries(resolvedEntries)
}

type RetryOpts = {
  params?: ExternalParamsRecord
  headers?: ExternalHeadersRecord
}

type ShapeStreamErrorHandler = (
  error: Error
) => void | RetryOpts | Promise<void | RetryOpts>

/**
 * Options for constructing a ShapeStream.
 */
export interface ShapeStreamOptions<T = never> {
  /**
   * The full URL to where the Shape is served. This can either be the Electric server
   * directly or a proxy. E.g. for a local Electric instance, you might set `http://localhost:3000/v1/shape`
   */
  url: string

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
  handle?: string

  /**
   * HTTP headers to attach to requests made by the client.
   * Values can be strings or functions (sync or async) that return strings.
   * Function values are resolved in parallel when needed, making this useful
   * for authentication tokens or other dynamic headers.
   */
  headers?: ExternalHeadersRecord

  /**
   * Additional request parameters to attach to the URL.
   * Values can be strings, string arrays, or functions (sync or async) that return these types.
   * Function values are resolved in parallel when needed, making this useful
   * for user-specific parameters or dynamic filters.
   *
   * These will be merged with Electric's standard parameters.
   * Note: You cannot use Electric's reserved parameter names
   * (offset, handle, live, cursor).
   *
   * PostgreSQL-specific options like table, where, columns, and replica
   * should be specified here.
   */
  params?: ExternalParamsRecord

  /**
   * Automatically fetch updates to the Shape. If you just want to sync the current
   * shape and stop, pass false.
   */
  subscribe?: boolean

  /**
   * @deprecated No longer experimental, use {@link liveSse} instead.
   */
  experimentalLiveSse?: boolean

  /**
   * Use Server-Sent Events (SSE) for live updates.
   */
  liveSse?: boolean

  /**
   * Initial data loading mode
   */
  log?: LogMode

  signal?: AbortSignal
  fetchClient?: typeof fetch
  backoffOptions?: BackoffOptions
  parser?: Parser<T>

  /**
   * Function to transform rows after parsing (e.g., for encryption, type coercion).
   * Applied to data received from Electric.
   *
   * **Note**: If you're using `transformer` solely for column name transformation
   * (e.g., snake_case → camelCase), consider using `columnMapper` instead, which
   * provides bidirectional transformation and automatically encodes WHERE clauses.
   *
   * **Execution order** when both are provided:
   * 1. `columnMapper.decode` runs first (renames columns)
   * 2. `transformer` runs second (transforms values)
   *
   * @example
   * ```typescript
   * // For column renaming only - use columnMapper
   * import { snakeCamelMapper } from '@electric-sql/client'
   * const stream = new ShapeStream({ columnMapper: snakeCamelMapper() })
   * ```
   *
   * @example
   * ```typescript
   * // For value transformation (encryption, etc.) - use transformer
   * const stream = new ShapeStream({
   *   transformer: (row) => ({
   *     ...row,
   *     encrypted_field: decrypt(row.encrypted_field)
   *   })
   * })
   * ```
   *
   * @example
   * ```typescript
   * // Use both together
   * const stream = new ShapeStream({
   *   columnMapper: snakeCamelMapper(), // Runs first: renames columns
   *   transformer: (row) => ({         // Runs second: transforms values
   *     ...row,
   *     encryptedData: decrypt(row.encryptedData)
   *   })
   * })
   * ```
   */
  transformer?: TransformFunction<T>

  /**
   * Bidirectional column name mapper for transforming between database column names
   * (e.g., snake_case) and application column names (e.g., camelCase).
   *
   * The mapper handles both:
   * - **Decoding**: Database → Application (applied to query results)
   * - **Encoding**: Application → Database (applied to WHERE clauses)
   *
   * @example
   * ```typescript
   * // Most common case: snake_case ↔ camelCase
   * import { snakeCamelMapper } from '@electric-sql/client'
   *
   * const stream = new ShapeStream({
   *   url: 'http://localhost:3000/v1/shape',
   *   params: { table: 'todos' },
   *   columnMapper: snakeCamelMapper()
   * })
   * ```
   *
   * @example
   * ```typescript
   * // Custom mapping
   * import { createColumnMapper } from '@electric-sql/client'
   *
   * const stream = new ShapeStream({
   *   columnMapper: createColumnMapper({
   *     user_id: 'userId',
   *     project_id: 'projectId',
   *     created_at: 'createdAt'
   *   })
   * })
   * ```
   */
  columnMapper?: ColumnMapper

  /**
   * A function for handling shapestream errors.
   *
   * **Automatic retries**: The client automatically retries 5xx server errors, network
   * errors, and 429 rate limits with exponential backoff. The `onError` callback is
   * only invoked after these automatic retries are exhausted, or for non-retryable
   * errors like 4xx client errors.
   *
   * When not provided, non-retryable errors will be thrown and syncing will stop.
   *
   * **Return value behavior**:
   * - Return an **object** (RetryOpts or empty `{}`) to retry syncing:
   *   - `{}` - Retry with the same params and headers
   *   - `{ params }` - Retry with modified params
   *   - `{ headers }` - Retry with modified headers (e.g., refreshed auth token)
   *   - `{ params, headers }` - Retry with both modified
   * - Return **void** or **undefined** to stop the stream permanently
   *
   * **Important**: If you want syncing to continue after an error (e.g., to retry
   * on network failures), you MUST return at least an empty object `{}`. Simply
   * logging the error and returning nothing will stop syncing.
   *
   * Supports async functions that return `Promise<void | RetryOpts>`.
   *
   * @example
   * ```typescript
   * // Retry on network errors, stop on others
   * onError: (error) => {
   *   console.error('Stream error:', error)
   *   if (error instanceof FetchError && error.status >= 500) {
   *     return {} // Retry with same params
   *   }
   *   // Return void to stop on other errors
   * }
   * ```
   *
   * @example
   * ```typescript
   * // Refresh auth token on 401
   * onError: async (error) => {
   *   if (error instanceof FetchError && error.status === 401) {
   *     const newToken = await refreshAuthToken()
   *     return { headers: { Authorization: `Bearer ${newToken}` } }
   *   }
   *   return {} // Retry other errors
   * }
   * ```
   */
  onError?: ShapeStreamErrorHandler

  /**
   * HTTP method to use for subset snapshot requests (`requestSnapshot`/`fetchSnapshot`).
   *
   * - `'GET'` (default): Sends subset params as URL query parameters. May fail with
   *   HTTP 414 errors for large queries with many parameters.
   * - `'POST'`: Sends subset params in request body as JSON. Recommended for queries
   *   with large parameter lists (e.g., `WHERE id = ANY($1)` with hundreds of IDs).
   *
   * This can be overridden per-request by passing `method` in the subset params.
   *
   * @example
   * ```typescript
   * const stream = new ShapeStream({
   *   url: 'http://localhost:3000/v1/shape',
   *   params: { table: 'items' },
   *   subsetMethod: 'POST', // Use POST for all subset requests
   * })
   * ```
   */
  subsetMethod?: `GET` | `POST`
}

export interface ShapeStreamInterface<T extends Row<unknown> = Row> {
  subscribe(
    callback: (
      messages: Message<T>[]
    ) => MaybePromise<void> | { columns?: (keyof T)[] },
    onError?: (error: FetchError | Error) => void
  ): () => void
  unsubscribeAll(): void

  isLoading(): boolean
  lastSyncedAt(): number | undefined
  lastSynced(): number
  isConnected(): boolean
  hasStarted(): boolean

  isUpToDate: boolean
  lastOffset: Offset
  shapeHandle?: string
  error?: unknown
  mode: LogMode

  forceDisconnectAndRefresh(): Promise<void>

  requestSnapshot(params: SubsetParams): Promise<{
    metadata: SnapshotMetadata
    data: Array<Message<T>>
  }>

  fetchSnapshot(opts: SubsetParams): Promise<{
    metadata: SnapshotMetadata
    data: Array<ChangeMessage<T>>
  }>
}

/**
 * Creates a canonical shape key from a URL excluding only Electric protocol parameters
 */
function canonicalShapeKey(url: URL): string {
  const cleanUrl = new URL(url.origin + url.pathname)

  // Copy all params except Electric protocol ones that vary between requests
  for (const [key, value] of url.searchParams) {
    if (!ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(key)) {
      cleanUrl.searchParams.set(key, value)
    }
  }

  cleanUrl.searchParams.sort()
  return cleanUrl.toString()
}

/**
 * Reads updates to a shape from Electric using HTTP requests and long polling or
 * Server-Sent Events (SSE).
 * Notifies subscribers when new messages come in. Doesn't maintain any history of the
 * log but does keep track of the offset position and is the best way
 * to consume the HTTP `GET /v1/shape` api.
 *
 * @constructor
 * @param {ShapeStreamOptions} options - configure the shape stream
 * @example
 * Register a callback function to subscribe to the messages.
 * ```
 * const stream = new ShapeStream(options)
 * stream.subscribe(messages => {
 *   // messages is 1 or more row updates
 * })
 * ```
 *
 * To use Server-Sent Events (SSE) for real-time updates:
 * ```
 * const stream = new ShapeStream({
 *   url: `http://localhost:3000/v1/shape`,
 *   liveSse: true
 * })
 * ```
 *
 * To abort the stream, abort the `signal`
 * passed in via the `ShapeStreamOptions`.
 * ```
 * const aborter = new AbortController()
 * const issueStream = new ShapeStream({
 *   url: `${BASE_URL}/${table}`
 *   subscribe: true,
 *   signal: aborter.signal,
 * })
 * // Later...
 * aborter.abort()
 * ```
 */

export class ShapeStream<T extends Row<unknown> = Row>
  implements ShapeStreamInterface<T>
{
  static readonly Replica = {
    FULL: `full` as Replica,
    DEFAULT: `default` as Replica,
  }

  readonly options: ShapeStreamOptions<GetExtensions<T>>
  #error: unknown = null

  readonly #fetchClient: typeof fetch
  readonly #sseFetchClient: typeof fetch
  readonly #messageParser: MessageParser<T>

  readonly #subscribers = new Map<
    object,
    [
      (messages: Message<T>[]) => MaybePromise<void>,
      ((error: Error) => void) | undefined,
    ]
  >()

  #started = false
  #syncState: ShapeStreamState
  #connected: boolean = false
  #mode: LogMode
  #onError?: ShapeStreamErrorHandler
  #requestAbortController?: AbortController
  #refreshCount = 0
  #snapshotCounter = 0

  get #isRefreshing(): boolean {
    return this.#refreshCount > 0
  }
  #tickPromise?: Promise<void>
  #tickPromiseResolver?: () => void
  #tickPromiseRejecter?: (reason?: unknown) => void
  #messageChain = Promise.resolve<void[]>([]) // promise chain for incoming messages
  #snapshotTracker = new SnapshotTracker()
  #pauseLock: PauseLock
  #currentFetchUrl?: URL // Current fetch URL for computing shape key
  #lastSseConnectionStartTime?: number
  #minSseConnectionDuration = 1000 // Minimum expected SSE connection duration (1 second)
  #maxShortSseConnections = 3 // Fall back to long polling after this many short connections
  #sseBackoffBaseDelay = 100 // Base delay for exponential backoff (ms)
  #sseBackoffMaxDelay = 5000 // Maximum delay cap (ms)
  #unsubscribeFromVisibilityChanges?: () => void
  #unsubscribeFromWakeDetection?: () => void
  #maxStaleCacheRetries = 3
  // Fast-loop detection: track recent non-live requests to detect tight retry
  // loops caused by proxy/CDN misconfiguration or stale client-side caches
  #recentRequestEntries: Array<{ timestamp: number; offset: string }> = []
  #fastLoopWindowMs = 500
  #fastLoopThreshold = 5
  #fastLoopBackoffBaseMs = 100
  #fastLoopBackoffMaxMs = 5_000
  #fastLoopConsecutiveCount = 0
  #fastLoopMaxCount = 5

  constructor(options: ShapeStreamOptions<GetExtensions<T>>) {
    this.options = { subscribe: true, ...options }
    validateOptions(this.options)
    this.#syncState = createInitialState({
      offset: this.options.offset ?? `-1`,
      handle: this.options.handle,
    })

    this.#pauseLock = new PauseLock({
      onAcquired: () => {
        this.#syncState = this.#syncState.pause()
        if (this.#started) {
          this.#requestAbortController?.abort(PAUSE_STREAM)
        }
      },
      onReleased: () => {
        if (!this.#started) return
        if (this.options.signal?.aborted) return
        // Don't transition syncState here — let #requestShape handle
        // the PausedState→previous transition so it can detect
        // resumingFromPause and avoid live long-polling.
        this.#start().catch(() => {
          // Errors from #start are handled internally via onError.
          // This catch prevents unhandled promise rejection in Node/Bun.
        })
      },
    })

    // Build transformer chain: columnMapper.decode -> transformer
    // columnMapper transforms column names, transformer transforms values
    let transformer: TransformFunction<GetExtensions<T>> | undefined

    if (options.columnMapper) {
      const applyColumnMapper = (
        row: Row<GetExtensions<T>>
      ): Row<GetExtensions<T>> => {
        const result: Record<string, unknown> = {}
        for (const [dbKey, value] of Object.entries(row)) {
          const appKey = options.columnMapper!.decode(dbKey)
          result[appKey] = value
        }
        return result as Row<GetExtensions<T>>
      }

      transformer = options.transformer
        ? (row: Row<GetExtensions<T>>) =>
            options.transformer!(applyColumnMapper(row))
        : applyColumnMapper
    } else {
      transformer = options.transformer
    }

    this.#messageParser = new MessageParser<T>(options.parser, transformer)

    this.#onError = this.options.onError
    this.#mode = this.options.log ?? `full`

    const baseFetchClient =
      options.fetchClient ??
      ((...args: Parameters<typeof fetch>) => fetch(...args))

    const backOffOpts = {
      ...(options.backoffOptions ?? BackoffDefaults),
      onFailedAttempt: () => {
        this.#connected = false
        options.backoffOptions?.onFailedAttempt?.()
      },
    }
    const fetchWithBackoffClient = createFetchWithBackoff(
      baseFetchClient,
      backOffOpts
    )

    this.#sseFetchClient = createFetchWithResponseHeadersCheck(
      createFetchWithChunkBuffer(fetchWithBackoffClient)
    )

    this.#fetchClient = createFetchWithConsumedMessages(this.#sseFetchClient)

    this.#subscribeToVisibilityChanges()
    this.#subscribeToWakeDetection()
  }

  get shapeHandle() {
    return this.#syncState.handle
  }

  get error() {
    return this.#error
  }

  get isUpToDate() {
    return this.#syncState.isUpToDate
  }

  get lastOffset() {
    return this.#syncState.offset
  }

  get mode() {
    return this.#mode
  }

  async #start(): Promise<void> {
    this.#started = true

    try {
      await this.#requestShape()
    } catch (err) {
      this.#error = err
      if (err instanceof Error) {
        this.#syncState = this.#syncState.toErrorState(err)
      }

      // Check if onError handler wants to retry
      if (this.#onError) {
        const retryOpts = await this.#onError(err as Error)
        // Guard against null (typeof null === "object" in JavaScript)
        const isRetryable = !(err instanceof MissingHeadersError)
        if (retryOpts && typeof retryOpts === `object` && isRetryable) {
          // Update params/headers but don't reset offset
          // We want to continue from where we left off, not refetch everything
          if (retryOpts.params) {
            // Merge new params with existing params to preserve other parameters
            this.options.params = {
              ...(this.options.params ?? {}),
              ...retryOpts.params,
            }
          }

          if (retryOpts.headers) {
            // Merge new headers with existing headers to preserve other headers
            this.options.headers = {
              ...(this.options.headers ?? {}),
              ...retryOpts.headers,
            }
          }

          // Clear the error since we're retrying
          this.#error = null
          if (this.#syncState instanceof ErrorState) {
            this.#syncState = this.#syncState.retry()
          }
          this.#fastLoopConsecutiveCount = 0
          this.#recentRequestEntries = []

          // Restart from current offset
          this.#started = false
          await this.#start()
          return
        }
        // onError returned void, meaning it doesn't want to retry
        // This is an unrecoverable error, notify subscribers
        if (err instanceof Error) {
          this.#sendErrorToSubscribers(err)
        }
        this.#teardown()
        return
      }

      // No onError handler provided, this is an unrecoverable error
      // Notify subscribers and throw
      if (err instanceof Error) {
        this.#sendErrorToSubscribers(err)
      }
      this.#teardown()
      throw err
    }

    this.#teardown()
  }

  #teardown() {
    this.#connected = false
    this.#tickPromiseRejecter?.()
    this.#unsubscribeFromWakeDetection?.()
  }

  async #requestShape(): Promise<void> {
    if (this.#pauseLock.isPaused) return

    if (
      !this.options.subscribe &&
      (this.options.signal?.aborted || this.#syncState.isUpToDate)
    ) {
      return
    }

    // Only check for fast loops on non-live requests; live polling is expected to be rapid
    if (!this.#syncState.isUpToDate) {
      await this.#checkFastLoop()
    } else {
      this.#fastLoopConsecutiveCount = 0
      this.#recentRequestEntries = []
    }

    let resumingFromPause = false
    if (this.#syncState instanceof PausedState) {
      resumingFromPause = true
      this.#syncState = this.#syncState.resume()
    }

    const { url, signal } = this.options
    const { fetchUrl, requestHeaders } = await this.#constructUrl(
      url,
      resumingFromPause
    )
    const abortListener = await this.#createAbortListener(signal)
    const requestAbortController = this.#requestAbortController! // we know that it is not undefined because it is set by `this.#createAbortListener`

    // Re-check after async setup — the lock may have been acquired
    // during URL construction or abort controller creation (e.g., by
    // requestSnapshot), when the abort controller didn't exist yet.
    if (this.#pauseLock.isPaused) {
      if (abortListener && signal) {
        signal.removeEventListener(`abort`, abortListener)
      }
      this.#requestAbortController = undefined
      return
    }

    try {
      await this.#fetchShape({
        fetchUrl,
        requestAbortController,
        headers: requestHeaders,
        resumingFromPause,
      })
    } catch (e) {
      const abortReason = requestAbortController.signal.reason
      const isRestartAbort =
        requestAbortController.signal.aborted &&
        (abortReason === FORCE_DISCONNECT_AND_REFRESH ||
          abortReason === SYSTEM_WAKE)

      if (
        (e instanceof FetchError || e instanceof FetchBackoffAbortError) &&
        isRestartAbort
      ) {
        return this.#requestShape()
      }

      if (e instanceof FetchBackoffAbortError) {
        return // interrupted
      }

      if (e instanceof StaleCacheError) {
        // Received a stale cached response from CDN with an expired handle.
        // The #staleCacheBuster has been set in #onInitialResponse, so retry
        // the request which will include a random cache buster to bypass the
        // misconfigured CDN cache.
        return this.#requestShape()
      }

      if (!(e instanceof FetchError)) throw e // should never happen

      if (e.status == 409) {
        // Upon receiving a 409, we should start from scratch
        // with the newly provided shape handle, or a fallback
        // pseudo-handle based on the current one to act as a
        // consistent cache buster

        // Store the current shape URL as expired to avoid future 409s
        if (this.#syncState.handle) {
          const shapeKey = canonicalShapeKey(fetchUrl)
          expiredShapesCache.markExpired(shapeKey, this.#syncState.handle)
        }

        const newShapeHandle =
          e.headers[SHAPE_HANDLE_HEADER] || `${this.#syncState.handle!}-next`
        this.#reset(newShapeHandle)

        // must refetch control message might be in a list or not depending
        // on whether it came from an SSE request or long poll. The body may
        // also be null/undefined if a proxy returned an unexpected response.
        // Handle all cases defensively here.
        const messages409 = Array.isArray(e.json)
          ? e.json
          : e.json != null
            ? [e.json]
            : []
        await this.#publish(messages409 as Message<T>[])
        return this.#requestShape()
      } else {
        // errors that have reached this point are not actionable without
        // additional user input, such as 400s or failures to read the
        // body of a response, so we exit the loop and let #start handle it
        // Note: We don't notify subscribers here because onError might recover
        throw e
      }
    } finally {
      if (abortListener && signal) {
        signal.removeEventListener(`abort`, abortListener)
      }
      this.#requestAbortController = undefined
    }

    this.#tickPromiseResolver?.()
    return this.#requestShape()
  }

  /**
   * Detects tight retry loops (e.g., from stale client-side caches or
   * proxy/CDN misconfiguration) and attempts recovery. On first detection,
   * clears client-side caches (in-memory and localStorage) and resets the
   * stream to fetch from scratch.
   * If the loop persists, applies exponential backoff and eventually throws.
   */
  async #checkFastLoop(): Promise<void> {
    const now = Date.now()
    const currentOffset = this.#syncState.offset

    this.#recentRequestEntries = this.#recentRequestEntries.filter(
      (e) => now - e.timestamp < this.#fastLoopWindowMs
    )
    this.#recentRequestEntries.push({ timestamp: now, offset: currentOffset })

    // Only flag as a fast loop if requests are stuck at the same offset.
    // Normal rapid syncing advances the offset with each response.
    const sameOffsetCount = this.#recentRequestEntries.filter(
      (e) => e.offset === currentOffset
    ).length

    if (sameOffsetCount < this.#fastLoopThreshold) return

    this.#fastLoopConsecutiveCount++

    if (this.#fastLoopConsecutiveCount >= this.#fastLoopMaxCount) {
      throw new FetchError(
        502,
        undefined,
        undefined,
        {},
        this.options.url,
        `Client is stuck in a fast retry loop ` +
          `(${this.#fastLoopThreshold} requests in ${this.#fastLoopWindowMs}ms at the same offset, ` +
          `repeated ${this.#fastLoopMaxCount} times). ` +
          `Client-side caches were cleared automatically on first detection, but the loop persists. ` +
          `This usually indicates a proxy or CDN misconfiguration. ` +
          `Common causes:\n` +
          `  - Proxy is not including query parameters (handle, offset) in its cache key\n` +
          `  - CDN is serving stale 409 responses\n` +
          `  - Proxy is stripping required Electric headers from responses\n` +
          `For more information visit the troubleshooting guide: ${TROUBLESHOOTING_URL}`
      )
    }

    if (this.#fastLoopConsecutiveCount === 1) {
      console.warn(
        `[Electric] Detected fast retry loop ` +
          `(${this.#fastLoopThreshold} requests in ${this.#fastLoopWindowMs}ms at the same offset). ` +
          `Clearing client-side caches and resetting stream to recover. ` +
          `If this persists, check that your proxy includes all query parameters ` +
          `(especially 'handle' and 'offset') in its cache key, ` +
          `and that required Electric headers are forwarded to the client. ` +
          `For more information visit the troubleshooting guide: ${TROUBLESHOOTING_URL}`
      )

      if (this.#currentFetchUrl) {
        const shapeKey = canonicalShapeKey(this.#currentFetchUrl)
        expiredShapesCache.delete(shapeKey)
        upToDateTracker.delete(shapeKey)
      } else {
        expiredShapesCache.clear()
        upToDateTracker.clear()
      }
      this.#reset()
      this.#recentRequestEntries = []
      return
    }

    // Exponential backoff with full jitter
    const maxDelay = Math.min(
      this.#fastLoopBackoffMaxMs,
      this.#fastLoopBackoffBaseMs * Math.pow(2, this.#fastLoopConsecutiveCount)
    )
    const delayMs = Math.floor(Math.random() * maxDelay)

    await new Promise((resolve) => setTimeout(resolve, delayMs))

    this.#recentRequestEntries = []
  }

  async #constructUrl(
    url: string,
    resumingFromPause: boolean,
    subsetParams?: SubsetParams
  ) {
    // Resolve headers and params in parallel
    const [requestHeaders, params] = await Promise.all([
      resolveHeaders(this.options.headers),
      this.options.params
        ? toInternalParams(convertWhereParamsToObj(this.options.params))
        : undefined,
    ])

    // Validate params after resolution
    if (params) validateParams(params)

    const fetchUrl = new URL(url)

    // Add PostgreSQL-specific parameters
    if (params) {
      if (params.table) setQueryParam(fetchUrl, TABLE_QUERY_PARAM, params.table)
      if (params.where && typeof params.where === `string`) {
        const encodedWhere = encodeWhereClause(
          params.where,
          this.options.columnMapper?.encode
        )
        setQueryParam(fetchUrl, WHERE_QUERY_PARAM, encodedWhere)
      }
      if (params.columns) {
        // Get original columns array from options (before toInternalParams converted to string)
        const originalColumns = await resolveValue(this.options.params?.columns)
        if (Array.isArray(originalColumns)) {
          // Apply columnMapper encoding if present
          let encodedColumns = originalColumns.map(String)
          if (this.options.columnMapper) {
            encodedColumns = encodedColumns.map(
              this.options.columnMapper.encode
            )
          }
          // Quote each column name to handle special characters (commas, etc.)
          const serializedColumns = encodedColumns
            .map(quoteIdentifier)
            .join(`,`)
          setQueryParam(fetchUrl, COLUMNS_QUERY_PARAM, serializedColumns)
        } else {
          // Fallback: columns was already a string
          setQueryParam(fetchUrl, COLUMNS_QUERY_PARAM, params.columns)
        }
      }
      if (params.replica) setQueryParam(fetchUrl, REPLICA_PARAM, params.replica)
      if (params.params)
        setQueryParam(fetchUrl, WHERE_PARAMS_PARAM, params.params)

      // Add any remaining custom parameters
      const customParams = { ...params }
      delete customParams.table
      delete customParams.where
      delete customParams.columns
      delete customParams.replica
      delete customParams.params

      for (const [key, value] of Object.entries(customParams)) {
        setQueryParam(fetchUrl, key, value)
      }
    }

    if (subsetParams) {
      // Prefer structured expressions when available (allows proper columnMapper application)
      // Fall back to legacy string format for backwards compatibility
      if (subsetParams.whereExpr) {
        // Compile structured expression with columnMapper applied
        const compiledWhere = compileExpression(
          subsetParams.whereExpr,
          this.options.columnMapper?.encode
        )
        setQueryParam(fetchUrl, SUBSET_PARAM_WHERE, compiledWhere)
        // Also send the structured expression for servers that support it
        fetchUrl.searchParams.set(
          SUBSET_PARAM_WHERE_EXPR,
          JSON.stringify(subsetParams.whereExpr)
        )
      } else if (subsetParams.where && typeof subsetParams.where === `string`) {
        // Legacy string format (no columnMapper applied to already-compiled SQL)
        const encodedWhere = encodeWhereClause(
          subsetParams.where,
          this.options.columnMapper?.encode
        )
        setQueryParam(fetchUrl, SUBSET_PARAM_WHERE, encodedWhere)
      }

      if (subsetParams.params)
        // Serialize params as JSON to keep the parameter name constant for proxy configs
        fetchUrl.searchParams.set(
          SUBSET_PARAM_WHERE_PARAMS,
          bigintSafeStringify(subsetParams.params)
        )
      if (subsetParams.limit)
        setQueryParam(fetchUrl, SUBSET_PARAM_LIMIT, subsetParams.limit)
      if (subsetParams.offset)
        setQueryParam(fetchUrl, SUBSET_PARAM_OFFSET, subsetParams.offset)

      // Prefer structured ORDER BY expressions when available
      if (subsetParams.orderByExpr) {
        // Compile structured ORDER BY with columnMapper applied
        const compiledOrderBy = compileOrderBy(
          subsetParams.orderByExpr,
          this.options.columnMapper?.encode
        )
        setQueryParam(fetchUrl, SUBSET_PARAM_ORDER_BY, compiledOrderBy)
        // Also send the structured expression for servers that support it
        fetchUrl.searchParams.set(
          SUBSET_PARAM_ORDER_BY_EXPR,
          JSON.stringify(subsetParams.orderByExpr)
        )
      } else if (
        subsetParams.orderBy &&
        typeof subsetParams.orderBy === `string`
      ) {
        // Legacy string format
        const encodedOrderBy = encodeWhereClause(
          subsetParams.orderBy,
          this.options.columnMapper?.encode
        )
        setQueryParam(fetchUrl, SUBSET_PARAM_ORDER_BY, encodedOrderBy)
      }
    }

    // Add state-specific parameters (offset, handle, live cache busters, etc.)
    this.#syncState.applyUrlParams(fetchUrl, {
      isSnapshotRequest: subsetParams !== undefined,
      // Don't long-poll when resuming from pause or refreshing — avoids
      // a 20s hold during which `isConnected` would be false
      canLongPoll: !this.#isRefreshing && !resumingFromPause,
    })
    fetchUrl.searchParams.set(LOG_MODE_QUERY_PARAM, this.#mode)

    // Add cache buster for shapes known to be expired to prevent 409s
    const shapeKey = canonicalShapeKey(fetchUrl)
    const expiredHandle = expiredShapesCache.getExpiredHandle(shapeKey)
    if (expiredHandle) {
      fetchUrl.searchParams.set(EXPIRED_HANDLE_QUERY_PARAM, expiredHandle)
    }

    // sort query params in-place for stable URLs and improved cache hits
    fetchUrl.searchParams.sort()

    return {
      fetchUrl,
      requestHeaders,
    }
  }

  async #createAbortListener(signal?: AbortSignal) {
    // Create a new AbortController for this request
    this.#requestAbortController = new AbortController()

    // If user provided a signal, listen to it and pass on the reason for the abort
    if (signal) {
      const abortListener = () => {
        this.#requestAbortController?.abort(signal.reason)
      }

      signal.addEventListener(`abort`, abortListener, { once: true })

      if (signal.aborted) {
        // If the signal is already aborted, abort the request immediately
        this.#requestAbortController?.abort(signal.reason)
      }

      return abortListener
    }
  }

  /**
   * Processes response metadata (headers, status) and updates sync state.
   * Returns `true` if the response body should be processed by the caller,
   * or `false` if the response was ignored (stale) and the body should be skipped.
   * Throws on stale-retry (to trigger a retry with cache buster).
   */
  async #onInitialResponse(response: Response): Promise<boolean> {
    const { headers, status } = response
    const shapeHandle = headers.get(SHAPE_HANDLE_HEADER)
    const shapeKey = this.#currentFetchUrl
      ? canonicalShapeKey(this.#currentFetchUrl)
      : null
    const expiredHandle = shapeKey
      ? expiredShapesCache.getExpiredHandle(shapeKey)
      : null

    const transition = this.#syncState.handleResponseMetadata({
      status,
      responseHandle: shapeHandle,
      responseOffset: headers.get(CHUNK_LAST_OFFSET_HEADER) as Offset | null,
      responseCursor: headers.get(LIVE_CACHE_BUSTER_HEADER),
      responseSchema: getSchemaFromHeaders(headers),
      expiredHandle,
      now: Date.now(),
      maxStaleCacheRetries: this.#maxStaleCacheRetries,
      createCacheBuster: () =>
        `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    })

    this.#syncState = transition.state

    if (transition.action === `stale-retry`) {
      // Cancel the response body to release the connection before retrying.
      await response.body?.cancel()
      if (transition.exceededMaxRetries) {
        throw new FetchError(
          502,
          undefined,
          undefined,
          {},
          this.#currentFetchUrl?.toString() ?? ``,
          `CDN continues serving stale cached responses after ${this.#maxStaleCacheRetries} retry attempts. ` +
            `This indicates a severe proxy/CDN misconfiguration. ` +
            `Check that your proxy includes all query parameters (especially 'handle' and 'offset') in its cache key. ` +
            `For more information visit the troubleshooting guide: ${TROUBLESHOOTING_URL}`
        )
      }
      console.warn(
        `[Electric] Received stale cached response with expired shape handle. ` +
          `This should not happen and indicates a proxy/CDN caching misconfiguration. ` +
          `The response contained handle "${shapeHandle}" which was previously marked as expired. ` +
          `Check that your proxy includes all query parameters (especially 'handle' and 'offset') in its cache key. ` +
          `For more information visit the troubleshooting guide: ${TROUBLESHOOTING_URL} ` +
          `Retrying with a random cache buster to bypass the stale cache (attempt ${this.#syncState.staleCacheRetryCount}/${this.#maxStaleCacheRetries}).`
      )
      throw new StaleCacheError(
        `Received stale cached response with expired handle "${shapeHandle}". ` +
          `This indicates a proxy/CDN caching misconfiguration. ` +
          `Check that your proxy includes all query parameters (especially 'handle' and 'offset') in its cache key.`
      )
    }

    if (transition.action === `ignored`) {
      // We already have a valid handle, so ignore the entire stale response
      // (both metadata and body) to prevent a mismatch between our current
      // handle and the stale data.
      console.warn(
        `[Electric] Received stale cached response with expired shape handle. ` +
          `This should not happen and indicates a proxy/CDN caching misconfiguration. ` +
          `The response contained handle "${shapeHandle}" which was previously marked as expired. ` +
          `Check that your proxy includes all query parameters (especially 'handle' and 'offset') in its cache key. ` +
          `Ignoring the stale response and continuing with handle "${this.#syncState.handle}".`
      )
      return false
    }

    return true
  }

  async #onMessages(batch: Array<Message<T>>, isSseMessage = false) {
    if (!Array.isArray(batch)) {
      console.warn(
        `[Electric] #onMessages called with non-array argument (${typeof batch}). ` +
          `This is a client bug — please report it.`
      )
      return
    }
    if (batch.length === 0) return

    const lastMessage = batch[batch.length - 1]
    const hasUpToDateMessage = isUpToDateMessage(lastMessage)
    const upToDateOffset = hasUpToDateMessage
      ? getOffset(lastMessage)
      : undefined

    const transition = this.#syncState.handleMessageBatch({
      hasMessages: true,
      hasUpToDateMessage,
      isSse: isSseMessage,
      upToDateOffset,
      now: Date.now(),
      currentCursor: this.#syncState.liveCacheBuster,
    })
    this.#syncState = transition.state

    if (hasUpToDateMessage) {
      if (transition.suppressBatch) {
        return
      }

      if (this.#currentFetchUrl) {
        const shapeKey = canonicalShapeKey(this.#currentFetchUrl)
        upToDateTracker.recordUpToDate(
          shapeKey,
          this.#syncState.liveCacheBuster
        )
      }
    }

    // Filter messages using snapshot tracker
    const messagesToProcess = batch.filter((message) => {
      if (isChangeMessage(message)) {
        return !this.#snapshotTracker.shouldRejectMessage(message)
      }
      return true // Always process control messages
    })

    await this.#publish(messagesToProcess)
  }

  /**
   * Fetches the shape from the server using either long polling or SSE.
   * Upon receiving a successful response, the #onInitialResponse method is called.
   * Afterwards, the #onMessages method is called for all the incoming updates.
   * @param opts - The options for the request.
   * @returns A promise that resolves when the request is complete (i.e. the long poll receives a response or the SSE connection is closed).
   */
  async #fetchShape(opts: {
    fetchUrl: URL
    requestAbortController: AbortController
    headers: Record<string, string>
    resumingFromPause?: boolean
  }): Promise<void> {
    // Store current fetch URL for shape key computation
    this.#currentFetchUrl = opts.fetchUrl

    // Check if we should enter replay mode (replaying cached responses)
    // This happens when we're starting fresh (offset=-1 or before first up-to-date)
    // and there's a recent up-to-date in localStorage (< 60s)
    if (!this.#syncState.isUpToDate && this.#syncState.canEnterReplayMode()) {
      const shapeKey = canonicalShapeKey(opts.fetchUrl)
      const lastSeenCursor = upToDateTracker.shouldEnterReplayMode(shapeKey)
      if (lastSeenCursor) {
        // Enter replay mode and store the last seen cursor
        this.#syncState = this.#syncState.enterReplayMode(lastSeenCursor)
      }
    }

    const useSse = this.options.liveSse ?? this.options.experimentalLiveSse
    if (
      this.#syncState.shouldUseSse({
        liveSseEnabled: !!useSse,
        isRefreshing: this.#isRefreshing,
        resumingFromPause: !!opts.resumingFromPause,
      })
    ) {
      opts.fetchUrl.searchParams.set(EXPERIMENTAL_LIVE_SSE_QUERY_PARAM, `true`)
      opts.fetchUrl.searchParams.set(LIVE_SSE_QUERY_PARAM, `true`)
      return this.#requestShapeSSE(opts)
    }

    return this.#requestShapeLongPoll(opts)
  }

  async #requestShapeLongPoll(opts: {
    fetchUrl: URL
    requestAbortController: AbortController
    headers: Record<string, string>
  }): Promise<void> {
    const { fetchUrl, requestAbortController, headers } = opts
    const response = await this.#fetchClient(fetchUrl.toString(), {
      signal: requestAbortController.signal,
      headers,
    })

    this.#connected = true
    const shouldProcessBody = await this.#onInitialResponse(response)
    if (!shouldProcessBody) return

    const schema = this.#syncState.schema! // we know that it is not undefined because it is set by `this.#onInitialResponse`
    const res = await response.text()
    const messages = res || `[]`
    const batch = this.#messageParser.parse<Array<Message<T>>>(messages, schema)

    if (!Array.isArray(batch)) {
      const preview = bigintSafeStringify(batch)?.slice(0, 200)
      throw new FetchError(
        response.status,
        `Received non-array response body from shape endpoint. ` +
          `This may indicate a proxy or CDN is returning an unexpected response. ` +
          `Expected a JSON array, got ${typeof batch}: ${preview}`,
        undefined,
        Object.fromEntries(response.headers.entries()),
        fetchUrl.toString()
      )
    }

    await this.#onMessages(batch)
  }

  async #requestShapeSSE(opts: {
    fetchUrl: URL
    requestAbortController: AbortController
    headers: Record<string, string>
  }): Promise<void> {
    const { fetchUrl, requestAbortController, headers } = opts
    const fetch = this.#sseFetchClient

    // Track when the SSE connection starts
    this.#lastSseConnectionStartTime = Date.now()

    // Add Accept header for SSE requests
    const sseHeaders = {
      ...headers,
      Accept: `text/event-stream`,
    }

    let ignoredStaleResponse = false
    try {
      let buffer: Array<Message<T>> = []
      await fetchEventSource(fetchUrl.toString(), {
        headers: sseHeaders,
        fetch,
        onopen: async (response: Response) => {
          this.#connected = true
          const shouldProcessBody = await this.#onInitialResponse(response)
          if (!shouldProcessBody) {
            ignoredStaleResponse = true
            throw new Error(`stale response ignored`)
          }
        },
        onmessage: (event: EventSourceMessage) => {
          if (event.data) {
            // event.data is a single JSON object
            const schema = this.#syncState.schema! // we know that it is not undefined because it is set in onopen when we call this.#onInitialResponse
            const message = this.#messageParser.parse<Message<T>>(
              event.data,
              schema
            )
            buffer.push(message)

            if (isUpToDateMessage(message)) {
              // Flush the buffer on up-to-date message.
              // Ensures that we only process complete batches of operations.
              this.#onMessages(buffer, true)
              buffer = []
            }
          }
        },
        onerror: (error: Error) => {
          // rethrow to close the SSE connection
          throw error
        },
        signal: requestAbortController.signal,
      })
    } catch (error) {
      if (ignoredStaleResponse) {
        // Stale response was ignored in onopen — let the fetch loop retry
        return
      }
      if (requestAbortController.signal.aborted) {
        // An abort during SSE stream parsing produces a raw AbortError
        // instead of going through createFetchWithBackoff -- wrap it so
        // #start handles it correctly.
        throw new FetchBackoffAbortError()
      }
      // Re-throw known Electric errors so the caller can handle them
      // (e.g., 409 shape rotation, stale cache retry, missing headers).
      // Other errors (body parsing, SSE protocol failures, null body)
      // are SSE connection failures handled by the fallback mechanism
      // in the finally block below.
      if (
        error instanceof FetchError ||
        error instanceof StaleCacheError ||
        error instanceof MissingHeadersError
      ) {
        throw error
      }
    } finally {
      // Check if the SSE connection closed too quickly
      // This can happen when responses are cached or when the proxy/server
      // is misconfigured for SSE and closes the connection immediately
      const connectionDuration = Date.now() - this.#lastSseConnectionStartTime!
      const wasAborted = requestAbortController.signal.aborted

      const transition = this.#syncState.handleSseConnectionClosed({
        connectionDuration,
        wasAborted,
        minConnectionDuration: this.#minSseConnectionDuration,
        maxShortConnections: this.#maxShortSseConnections,
      })
      this.#syncState = transition.state

      if (transition.fellBackToLongPolling) {
        console.warn(
          `[Electric] SSE connections are closing immediately (possibly due to proxy buffering or misconfiguration). ` +
            `Falling back to long polling. ` +
            `Your proxy must support streaming SSE responses (not buffer the complete response). ` +
            `Configuration: Nginx add 'X-Accel-Buffering: no', Caddy add 'flush_interval -1' to reverse_proxy. ` +
            `Note: Do NOT disable caching entirely - Electric uses cache headers to enable request collapsing for efficiency.`
        )
      } else if (transition.wasShortConnection) {
        // Exponential backoff with full jitter: random(0, min(cap, base * 2^attempt))
        const maxDelay = Math.min(
          this.#sseBackoffMaxDelay,
          this.#sseBackoffBaseDelay *
            Math.pow(2, this.#syncState.consecutiveShortSseConnections)
        )
        const delayMs = Math.floor(Math.random() * maxDelay)
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
    }
  }

  subscribe(
    callback: (messages: Message<T>[]) => MaybePromise<void>,
    onError: (error: Error) => void = () => {}
  ) {
    const subscriptionId = {}

    this.#subscribers.set(subscriptionId, [callback, onError])
    if (!this.#started) this.#start()

    return () => {
      this.#subscribers.delete(subscriptionId)
    }
  }

  unsubscribeAll(): void {
    this.#subscribers.clear()
    this.#unsubscribeFromVisibilityChanges?.()
    this.#unsubscribeFromWakeDetection?.()
  }

  /** Unix time at which we last synced. Undefined until first successful up-to-date. */
  lastSyncedAt(): number | undefined {
    return this.#syncState.lastSyncedAt
  }

  /** Time elapsed since last sync (in ms). Infinity if we did not yet sync. */
  lastSynced(): number {
    if (this.#syncState.lastSyncedAt === undefined) return Infinity
    return Date.now() - this.#syncState.lastSyncedAt
  }

  /** Indicates if we are connected to the Electric sync service. */
  isConnected(): boolean {
    return this.#connected
  }

  /** True during initial fetch. False afterwards.  */
  isLoading(): boolean {
    return !this.#syncState.isUpToDate
  }

  hasStarted(): boolean {
    return this.#started
  }

  isPaused(): boolean {
    return this.#pauseLock.isPaused
  }

  /** Await the next tick of the request loop */
  async #nextTick() {
    if (this.#pauseLock.isPaused) {
      throw new Error(
        `Cannot wait for next tick while PauseLock is held — this would deadlock because the request loop is paused`
      )
    }
    if (this.#tickPromise) {
      return this.#tickPromise
    }
    this.#tickPromise = new Promise((resolve, reject) => {
      this.#tickPromiseResolver = resolve
      this.#tickPromiseRejecter = reject
    })
    this.#tickPromise.finally(() => {
      this.#tickPromise = undefined
      this.#tickPromiseResolver = undefined
      this.#tickPromiseRejecter = undefined
    })
    return this.#tickPromise
  }

  /**
   * Refreshes the shape stream.
   * This preemptively aborts any ongoing long poll and reconnects without
   * long polling, ensuring that the stream receives an up to date message with the
   * latest LSN from Postgres at that point in time.
   */
  async forceDisconnectAndRefresh(): Promise<void> {
    this.#refreshCount++
    try {
      if (
        this.#syncState.isUpToDate &&
        !this.#requestAbortController?.signal.aborted
      ) {
        // If we are "up to date", any current request will be a "live" request
        // and needs to be aborted
        this.#requestAbortController?.abort(FORCE_DISCONNECT_AND_REFRESH)
      }
      await this.#nextTick()
    } finally {
      this.#refreshCount--
    }
  }

  async #publish(messages: Message<T>[]): Promise<void[]> {
    // We process messages asynchronously
    // but SSE's `onmessage` handler is synchronous.
    // We use a promise chain to ensure that the handlers
    // execute sequentially in the order the messages were received.
    this.#messageChain = this.#messageChain.then(() =>
      Promise.all(
        Array.from(this.#subscribers.values()).map(async ([callback, __]) => {
          try {
            await callback(messages)
          } catch (err) {
            queueMicrotask(() => {
              throw err
            })
          }
        })
      )
    )

    return this.#messageChain
  }

  #sendErrorToSubscribers(error: Error) {
    this.#subscribers.forEach(([_, errorFn]) => {
      errorFn?.(error)
    })
  }

  #hasBrowserVisibilityAPI(): boolean {
    return (
      typeof document === `object` &&
      typeof document.hidden === `boolean` &&
      typeof document.addEventListener === `function`
    )
  }

  #subscribeToVisibilityChanges() {
    if (this.#hasBrowserVisibilityAPI()) {
      const visibilityHandler = () => {
        if (document.hidden) {
          this.#pauseLock.acquire(`visibility`)
        } else {
          this.#pauseLock.release(`visibility`)
        }
      }

      document.addEventListener(`visibilitychange`, visibilityHandler)

      // Store cleanup function to remove the event listener
      this.#unsubscribeFromVisibilityChanges = () => {
        document.removeEventListener(`visibilitychange`, visibilityHandler)
      }
    }
  }

  /**
   * Detects system wake from sleep using timer gap detection.
   * When the system sleeps, setInterval timers are paused. On wake,
   * the elapsed wall-clock time since the last tick will be much larger
   * than the interval period, indicating the system was asleep.
   *
   * Only active in non-browser environments (Bun, Node.js) where
   * `document.visibilitychange` is not available. In browsers,
   * `#subscribeToVisibilityChanges` handles this instead. Without wake
   * detection, in-flight HTTP requests (long-poll or SSE) may hang until
   * the OS TCP timeout.
   */
  #subscribeToWakeDetection() {
    if (this.#hasBrowserVisibilityAPI()) return

    const INTERVAL_MS = 2_000
    const WAKE_THRESHOLD_MS = 4_000

    let lastTickTime = Date.now()

    const timer = setInterval(() => {
      const now = Date.now()
      const elapsed = now - lastTickTime
      lastTickTime = now

      if (elapsed > INTERVAL_MS + WAKE_THRESHOLD_MS) {
        if (!this.#pauseLock.isPaused && this.#requestAbortController) {
          this.#refreshCount++
          this.#requestAbortController.abort(SYSTEM_WAKE)
          // Wake handler is synchronous (setInterval callback) so we can't
          // use try/finally + await like forceDisconnectAndRefresh. Instead,
          // decrement via queueMicrotask — safe because the abort triggers
          // #requestShape to re-run, which reads #isRefreshing synchronously
          // before the microtask fires.
          queueMicrotask(() => {
            this.#refreshCount--
          })
        }
      }
    }, INTERVAL_MS)

    // Ensure the timer doesn't prevent the process from exiting
    if (typeof timer === `object` && `unref` in timer) {
      timer.unref()
    }

    this.#unsubscribeFromWakeDetection = () => {
      clearInterval(timer)
    }
  }

  /**
   * Resets the state of the stream, optionally with a provided
   * shape handle
   */
  #reset(handle?: string) {
    this.#syncState = this.#syncState.markMustRefetch(handle)
    this.#connected = false
    // releaseAllMatching intentionally doesn't fire onReleased — it's called
    // from within the running stream loop (#requestShape's 409 handler), so
    // the stream is already active and doesn't need a resume signal.
    this.#pauseLock.releaseAllMatching(`snapshot`)
  }

  /**
   * Request a snapshot for subset of data and inject it into the subscribed data stream.
   *
   * Only available when mode is `changes_only`.
   * Returns the insertion point & the data, but more importantly injects the data
   * into the subscribed data stream. Returned value is unlikely to be useful for the caller,
   * unless the caller has complicated additional logic.
   *
   * Data will be injected in a way that's also tracking further incoming changes, and it'll
   * skip the ones that are already in the snapshot.
   *
   * @param opts - The options for the snapshot request.
   * @returns The metadata and the data for the snapshot.
   */
  async requestSnapshot(opts: SubsetParams): Promise<{
    metadata: SnapshotMetadata
    data: Array<ChangeMessage<T>>
  }> {
    if (this.#mode === `full`) {
      throw new Error(
        `Snapshot requests are not supported in ${this.#mode} mode, as the consumer is guaranteed to observe all data`
      )
    }
    // Start the stream if not started — fire-and-forget like subscribe() does.
    // We must NOT await #start() because it runs the full request loop. The
    // PauseLock acquire below will abort the in-flight request, and the
    // re-check guard in #requestShape handles the race.
    if (!this.#started) {
      this.#start().catch(() => {})
    }

    const snapshotReason = `snapshot-${++this.#snapshotCounter}`

    this.#pauseLock.acquire(snapshotReason)

    // Warn if the snapshot holds the pause lock for too long — this likely
    // indicates a hung fetch or leaked lock. Visibility pauses are
    // intentionally long-lived so the warning lives here, not in PauseLock.
    const snapshotWarnTimer = setTimeout(() => {
      console.warn(
        `[Electric] Snapshot "${snapshotReason}" has held the pause lock for 30s — ` +
          `possible hung request or leaked lock. ` +
          `Current holders: ${[...new Set([snapshotReason])].join(`, `)}`
      )
    }, 30_000)

    try {
      const { metadata, data, responseOffset, responseHandle } =
        await this.fetchSnapshot(opts)

      const dataWithEndBoundary = (data as Array<Message<T>>).concat([
        { headers: { control: `snapshot-end`, ...metadata } },
        { headers: { control: `subset-end`, ...opts } },
      ])

      this.#snapshotTracker.addSnapshot(
        metadata,
        new Set(data.map((message) => message.key))
      )
      this.#onMessages(dataWithEndBoundary, false)

      // On cold start the stream's offset is still at "now". Advance it
      // to the snapshot's position so no updates are missed in between.
      if (responseOffset !== null || responseHandle !== null) {
        const transition = this.#syncState.handleResponseMetadata({
          status: 200,
          responseHandle,
          responseOffset,
          responseCursor: null,
          expiredHandle: null,
          now: Date.now(),
          maxStaleCacheRetries: this.#maxStaleCacheRetries,
          createCacheBuster: () =>
            `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        })
        if (transition.action === `accepted`) {
          this.#syncState = transition.state
        } else {
          console.warn(
            `[Electric] Snapshot response metadata was not accepted ` +
              `by state "${this.#syncState.kind}" (action: ${transition.action}). ` +
              `Stream offset was not advanced from snapshot.`
          )
        }
      }

      return {
        metadata,
        data,
      }
    } finally {
      clearTimeout(snapshotWarnTimer)
      this.#pauseLock.release(snapshotReason)
    }
  }

  /**
   * Fetch a snapshot for subset of data.
   * Returns the metadata and the data, but does not inject it into the subscribed data stream.
   *
   * By default, uses GET to send subset parameters as query parameters. This may hit URL length
   * limits (HTTP 414) with large WHERE clauses or many parameters. Set `method: 'POST'` or use
   * `subsetMethod: 'POST'` on the stream to send parameters in the request body instead.
   *
   * @param opts - The options for the snapshot request.
   * @returns The metadata, data, and the response's offset/handle for state advancement.
   */
  async fetchSnapshot(opts: SubsetParams): Promise<{
    metadata: SnapshotMetadata
    data: Array<ChangeMessage<T>>
    responseOffset: Offset | null
    responseHandle: string | null
  }> {
    const method = opts.method ?? this.options.subsetMethod ?? `GET`
    const usePost = method === `POST`

    let fetchUrl: URL
    let fetchOptions: RequestInit

    if (usePost) {
      const result = await this.#constructUrl(this.options.url, true)
      fetchUrl = result.fetchUrl
      fetchOptions = {
        method: `POST`,
        headers: {
          ...result.requestHeaders,
          'Content-Type': `application/json`,
        },
        body: bigintSafeStringify(this.#buildSubsetBody(opts)),
      }
    } else {
      const result = await this.#constructUrl(this.options.url, true, opts)
      fetchUrl = result.fetchUrl
      fetchOptions = { headers: result.requestHeaders }
    }

    // Capture handle before fetch to avoid race conditions if it changes during the request
    const usedHandle = this.#syncState.handle

    let response: Response
    try {
      response = await this.#fetchClient(fetchUrl.toString(), fetchOptions)
    } catch (e) {
      // Handle 409 "must-refetch" - shape handle changed/expired.
      // The fetch wrapper throws FetchError for non-OK responses, so we catch here.
      // Unlike #requestShape, we don't call #reset() here as that would
      // clear the pause lock and break requestSnapshot's pause/resume logic.
      if (e instanceof FetchError && e.status === 409) {
        if (usedHandle) {
          const shapeKey = canonicalShapeKey(fetchUrl)
          expiredShapesCache.markExpired(shapeKey, usedHandle)
        }

        // For snapshot 409s, only update the handle — don't reset offset/schema/etc.
        // The main stream is paused and should not be disturbed.
        const nextHandle =
          e.headers[SHAPE_HANDLE_HEADER] || `${usedHandle ?? `handle`}-next`
        this.#syncState = this.#syncState.withHandle(nextHandle)

        return this.fetchSnapshot(opts)
      }
      throw e
    }

    // Handle non-OK responses from custom fetch clients that bypass the wrapper chain
    if (!response.ok) {
      throw await FetchError.fromResponse(response, fetchUrl.toString())
    }

    const schema: Schema =
      this.#syncState.schema ??
      getSchemaFromHeaders(response.headers, {
        required: true,
        url: fetchUrl.toString(),
      })

    const { metadata, data: rawData } = await response.json()
    const data = this.#messageParser.parseSnapshotData<ChangeMessage<T>>(
      rawData,
      schema
    )

    const responseOffset =
      (response.headers.get(CHUNK_LAST_OFFSET_HEADER) as Offset) || null
    const responseHandle = response.headers.get(SHAPE_HANDLE_HEADER)

    return { metadata, data, responseOffset, responseHandle }
  }

  #buildSubsetBody(opts: SubsetParams): Record<string, unknown> {
    const body: Record<string, unknown> = {}

    if (opts.whereExpr) {
      body.where = compileExpression(
        opts.whereExpr,
        this.options.columnMapper?.encode
      )
      body.where_expr = opts.whereExpr
    } else if (opts.where && typeof opts.where === `string`) {
      body.where = encodeWhereClause(
        opts.where,
        this.options.columnMapper?.encode
      )
    }

    if (opts.params) {
      body.params = opts.params
    }

    if (opts.limit !== undefined) {
      body.limit = opts.limit
    }

    if (opts.offset !== undefined) {
      body.offset = opts.offset
    }

    if (opts.orderByExpr) {
      body.order_by = compileOrderBy(
        opts.orderByExpr,
        this.options.columnMapper?.encode
      )
      body.order_by_expr = opts.orderByExpr
    } else if (opts.orderBy && typeof opts.orderBy === `string`) {
      body.order_by = encodeWhereClause(
        opts.orderBy,
        this.options.columnMapper?.encode
      )
    }

    return body
  }
}

/**
 * Extracts the schema from response headers.
 * @param headers - The response headers
 * @param options - Options for schema extraction
 * @param options.required - If true, throws MissingHeadersError when header is missing. Defaults to false.
 * @param options.url - The URL to include in the error message if required is true
 * @returns The parsed schema, or an empty object if not required and header is missing
 * @throws {MissingHeadersError} if required is true and the header is missing
 */
function getSchemaFromHeaders(
  headers: Headers,
  options?: { required?: boolean; url?: string }
): Schema {
  const schemaHeader = headers.get(SHAPE_SCHEMA_HEADER)
  if (!schemaHeader) {
    if (options?.required && options?.url) {
      throw new MissingHeadersError(options.url, [SHAPE_SCHEMA_HEADER])
    }
    return {}
  }
  return JSON.parse(schemaHeader)
}

/**
 * Validates that no reserved parameter names are used in the provided params object
 * @throws {ReservedParamError} if any reserved parameter names are found
 */
function validateParams(params: Record<string, unknown> | undefined): void {
  if (!params) return

  const reservedParams = Object.keys(params).filter((key) =>
    RESERVED_PARAMS.has(key as ReservedParamKeys)
  )
  if (reservedParams.length > 0) {
    throw new ReservedParamError(reservedParams)
  }
}

function validateOptions<T>(options: Partial<ShapeStreamOptions<T>>): void {
  if (!options.url) {
    throw new MissingShapeUrlError()
  }
  if (options.signal && !(options.signal instanceof AbortSignal)) {
    throw new InvalidSignalError()
  }

  if (
    options.offset !== undefined &&
    options.offset !== `-1` &&
    options.offset !== `now` &&
    !options.handle
  ) {
    throw new MissingShapeHandleError()
  }

  validateParams(options.params)

  return
}

// `unknown` being in the value is a bit of defensive programming if user doesn't use TS
function setQueryParam(
  url: URL,
  key: string,
  value: Record<string, string> | string | unknown
): void {
  if (value === undefined || value == null) {
    return
  } else if (typeof value === `string`) {
    url.searchParams.set(key, value)
  } else if (typeof value === `object`) {
    for (const [k, v] of Object.entries(value)) {
      url.searchParams.set(`${key}[${k}]`, v)
    }
  } else {
    url.searchParams.set(key, value.toString())
  }
}

function convertWhereParamsToObj(
  allPgParams: ExternalParamsRecord<Row>
): ExternalParamsRecord<Row> {
  if (Array.isArray(allPgParams.params)) {
    return {
      ...allPgParams,
      params: Object.fromEntries(allPgParams.params.map((v, i) => [i + 1, v])),
    }
  }
  return allPgParams
}
