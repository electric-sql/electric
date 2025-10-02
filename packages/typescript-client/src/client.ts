import {
  Message,
  Offset,
  Schema,
  Row,
  MaybePromise,
  GetExtensions,
  ChangeMessage,
  SnapshotMetadata,
} from './types'
import { MessageParser, Parser, TransformFunction } from './parser'
import { getOffset, isUpToDateMessage, isChangeMessage } from './helpers'
import {
  FetchError,
  FetchBackoffAbortError,
  MissingShapeUrlError,
  InvalidSignalError,
  MissingShapeHandleError,
  ReservedParamError,
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
  EXPERIMENTAL_LIVE_SSE_QUERY_PARAM,
  ELECTRIC_PROTOCOL_QUERY_PARAMS,
  LOG_MODE_QUERY_PARAM,
  SUBSET_PARAM_WHERE,
  SUBSET_PARAM_WHERE_PARAMS,
  SUBSET_PARAM_LIMIT,
  SUBSET_PARAM_OFFSET,
  SUBSET_PARAM_ORDER_BY,
} from './constants'
import {
  EventSourceMessage,
  fetchEventSource,
} from '@microsoft/fetch-event-source'
import { expiredShapesCache } from './expired-shapes-cache'
import { SnapshotTracker } from './snapshot-tracker'

const RESERVED_PARAMS: Set<ReservedParamKeys> = new Set([
  LIVE_CACHE_BUSTER_QUERY_PARAM,
  SHAPE_HANDLE_QUERY_PARAM,
  LIVE_QUERY_PARAM,
  OFFSET_QUERY_PARAM,
])

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

export type SubsetParams = {
  where?: string
  params?: Record<string, string>
  limit?: number
  offset?: number
  orderBy?: string
}

type ReservedParamKeys =
  | typeof LIVE_CACHE_BUSTER_QUERY_PARAM
  | typeof SHAPE_HANDLE_QUERY_PARAM
  | typeof LIVE_QUERY_PARAM
  | typeof OFFSET_QUERY_PARAM
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
   * Experimental support for Server-Sent Events (SSE) for live updates.
   */
  experimentalLiveSse?: boolean

  /**
   * Initial data loading mode
   */
  log?: LogMode

  signal?: AbortSignal
  fetchClient?: typeof fetch
  backoffOptions?: BackoffOptions
  parser?: Parser<T>
  transformer?: TransformFunction<T>

  /**
   * A function for handling shapestream errors.
   * This is optional, when it is not provided any shapestream errors will be thrown.
   * If the function returns an object containing parameters and/or headers
   * the shapestream will apply those changes and try syncing again.
   * If the function returns void the shapestream is stopped.
   */
  onError?: ShapeStreamErrorHandler
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

  requestSnapshot(params: {
    where?: string
    params?: Record<string, string>
    limit: number
    offset?: number
    orderBy: string
  }): Promise<{
    metadata: SnapshotMetadata
    data: Array<Message<T>>
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
 *   experimentalLiveSse: true
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
    number,
    [
      (messages: Message<T>[]) => MaybePromise<void>,
      ((error: Error) => void) | undefined,
    ]
  >()

  #started = false
  #state = `active` as `active` | `pause-requested` | `paused`
  #lastOffset: Offset
  #liveCacheBuster: string // Seconds since our Electric Epoch 😎
  #lastSyncedAt?: number // unix time
  #isUpToDate: boolean = false
  #isMidStream: boolean = true
  #connected: boolean = false
  #shapeHandle?: string
  #mode: LogMode
  #schema?: Schema
  #onError?: ShapeStreamErrorHandler
  #requestAbortController?: AbortController
  #isRefreshing = false
  #tickPromise?: Promise<void>
  #tickPromiseResolver?: () => void
  #tickPromiseRejecter?: (reason?: unknown) => void
  #messageChain = Promise.resolve<void[]>([]) // promise chain for incoming messages
  #snapshotTracker = new SnapshotTracker()
  #activeSnapshotRequests = 0 // counter for concurrent snapshot requests
  #midStreamPromise?: Promise<void>
  #midStreamPromiseResolver?: () => void

  constructor(options: ShapeStreamOptions<GetExtensions<T>>) {
    this.options = { subscribe: true, ...options }
    validateOptions(this.options)
    this.#lastOffset = this.options.offset ?? `-1`
    this.#liveCacheBuster = ``
    this.#shapeHandle = this.options.handle
    this.#messageParser = new MessageParser<T>(
      options.parser,
      options.transformer
    )
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
  }

  get shapeHandle() {
    return this.#shapeHandle
  }

  get error() {
    return this.#error
  }

  get isUpToDate() {
    return this.#isUpToDate
  }

  get lastOffset() {
    return this.#lastOffset
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
      if (this.#onError) {
        const retryOpts = await this.#onError(err as Error)
        if (typeof retryOpts === `object`) {
          this.#reset()

          if (`params` in retryOpts) {
            this.options.params = retryOpts.params
          }

          if (`headers` in retryOpts) {
            this.options.headers = retryOpts.headers
          }

          // Restart
          this.#started = false
          this.#start()
        }
        return
      }

      // If no handler is provided for errors just throw so the error still bubbles up.
      throw err
    } finally {
      this.#connected = false
      this.#tickPromiseRejecter?.()
    }
  }

  async #requestShape(): Promise<void> {
    if (this.#state === `pause-requested`) {
      this.#state = `paused`

      return
    }

    if (
      !this.options.subscribe &&
      (this.options.signal?.aborted || this.#isUpToDate)
    ) {
      return
    }

    const resumingFromPause = this.#state === `paused`
    this.#state = `active`

    const { url, signal } = this.options
    const { fetchUrl, requestHeaders } = await this.#constructUrl(
      url,
      resumingFromPause
    )
    const abortListener = await this.#createAbortListener(signal)
    const requestAbortController = this.#requestAbortController! // we know that it is not undefined because it is set by `this.#createAbortListener`

    try {
      await this.#fetchShape({
        fetchUrl,
        requestAbortController,
        headers: requestHeaders,
        resumingFromPause,
      })
    } catch (e) {
      // Handle abort error triggered by refresh
      if (
        (e instanceof FetchError || e instanceof FetchBackoffAbortError) &&
        requestAbortController.signal.aborted &&
        requestAbortController.signal.reason === FORCE_DISCONNECT_AND_REFRESH
      ) {
        // Start a new request
        return this.#requestShape()
      }

      if (e instanceof FetchBackoffAbortError) {
        if (
          requestAbortController.signal.aborted &&
          requestAbortController.signal.reason === PAUSE_STREAM
        ) {
          this.#state = `paused`
        }
        return // interrupted
      }
      if (!(e instanceof FetchError)) throw e // should never happen

      if (e.status == 409) {
        // Upon receiving a 409, we should start from scratch
        // with the newly provided shape handle, or a fallback
        // pseudo-handle based on the current one to act as a
        // consistent cache buster

        // Store the current shape URL as expired to avoid future 409s
        if (this.#shapeHandle) {
          const shapeKey = canonicalShapeKey(fetchUrl)
          expiredShapesCache.markExpired(shapeKey, this.#shapeHandle)
        }

        const newShapeHandle =
          e.headers[SHAPE_HANDLE_HEADER] || `${this.#shapeHandle!}-next`
        this.#reset(newShapeHandle)
        await this.#publish(e.json as Message<T>[])
        return this.#requestShape()
      } else {
        // Notify subscribers
        this.#sendErrorToSubscribers(e)

        // errors that have reached this point are not actionable without
        // additional user input, such as 400s or failures to read the
        // body of a response, so we exit the loop
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
      if (params.where) setQueryParam(fetchUrl, WHERE_QUERY_PARAM, params.where)
      if (params.columns)
        setQueryParam(fetchUrl, COLUMNS_QUERY_PARAM, params.columns)
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
      if (subsetParams.where)
        setQueryParam(fetchUrl, SUBSET_PARAM_WHERE, subsetParams.where)
      if (subsetParams.params)
        setQueryParam(fetchUrl, SUBSET_PARAM_WHERE_PARAMS, subsetParams.params)
      if (subsetParams.limit)
        setQueryParam(fetchUrl, SUBSET_PARAM_LIMIT, subsetParams.limit)
      if (subsetParams.offset)
        setQueryParam(fetchUrl, SUBSET_PARAM_OFFSET, subsetParams.offset)
      if (subsetParams.orderBy)
        setQueryParam(fetchUrl, SUBSET_PARAM_ORDER_BY, subsetParams.orderBy)
    }

    // Add Electric's internal parameters
    fetchUrl.searchParams.set(OFFSET_QUERY_PARAM, this.#lastOffset)
    fetchUrl.searchParams.set(LOG_MODE_QUERY_PARAM, this.#mode)

    if (this.#isUpToDate) {
      // If we are resuming from a paused state, we don't want to perform a live request
      // because it could be a long poll that holds for 20sec
      // and during all that time `isConnected` will be false
      if (!this.#isRefreshing && !resumingFromPause) {
        fetchUrl.searchParams.set(LIVE_QUERY_PARAM, `true`)
      }
      fetchUrl.searchParams.set(
        LIVE_CACHE_BUSTER_QUERY_PARAM,
        this.#liveCacheBuster
      )
    }

    if (this.#shapeHandle) {
      // This should probably be a header for better cache breaking?
      fetchUrl.searchParams.set(SHAPE_HANDLE_QUERY_PARAM, this.#shapeHandle!)
    }

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

  async #onInitialResponse(response: Response) {
    const { headers, status } = response
    const shapeHandle = headers.get(SHAPE_HANDLE_HEADER)
    if (shapeHandle) {
      this.#shapeHandle = shapeHandle
    }

    const lastOffset = headers.get(CHUNK_LAST_OFFSET_HEADER)
    if (lastOffset) {
      this.#lastOffset = lastOffset as Offset
    }

    const liveCacheBuster = headers.get(LIVE_CACHE_BUSTER_HEADER)
    if (liveCacheBuster) {
      this.#liveCacheBuster = liveCacheBuster
    }

    const getSchema = (): Schema => {
      const schemaHeader = headers.get(SHAPE_SCHEMA_HEADER)
      return schemaHeader ? JSON.parse(schemaHeader) : {}
    }
    this.#schema = this.#schema ?? getSchema()

    // NOTE: 204s are deprecated, the Electric server should not
    // send these in latest versions but this is here for backwards
    // compatibility
    if (status === 204) {
      // There's no content so we are live and up to date
      this.#lastSyncedAt = Date.now()
    }
  }

  async #onMessages(batch: Array<Message<T>>, isSseMessage = false) {
    // Update isUpToDate
    if (batch.length > 0) {
      // Set isMidStream to true when we receive any data
      this.#isMidStream = true

      const lastMessage = batch[batch.length - 1]
      if (isUpToDateMessage(lastMessage)) {
        if (isSseMessage) {
          // Only use the offset from the up-to-date message if this was an SSE message.
          // If we would use this offset from a regular fetch, then it will be wrong
          // and we will get an "offset is out of bounds for this shape" error
          const offset = getOffset(lastMessage)
          if (offset) {
            this.#lastOffset = offset
          }
        }
        this.#lastSyncedAt = Date.now()
        this.#isUpToDate = true
        // Set isMidStream to false when we see an up-to-date message
        this.#isMidStream = false
        // Resolve the promise waiting for mid-stream to end
        this.#midStreamPromiseResolver?.()
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
  }

  /**
   * Fetches the shape from the server using either long polling or SSE.
   * Upon receiving a successfull response, the #onInitialResponse method is called.
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
    if (
      this.#isUpToDate &&
      this.options.experimentalLiveSse &&
      !this.#isRefreshing &&
      !opts.resumingFromPause
    ) {
      opts.fetchUrl.searchParams.set(EXPERIMENTAL_LIVE_SSE_QUERY_PARAM, `true`)
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
    await this.#onInitialResponse(response)

    const schema = this.#schema! // we know that it is not undefined because it is set by `this.#onInitialResponse`
    const res = await response.text()
    const messages = res || `[]`
    const batch = this.#messageParser.parse<Array<Message<T>>>(messages, schema)

    await this.#onMessages(batch)
  }

  async #requestShapeSSE(opts: {
    fetchUrl: URL
    requestAbortController: AbortController
    headers: Record<string, string>
  }): Promise<void> {
    const { fetchUrl, requestAbortController, headers } = opts
    const fetch = this.#sseFetchClient
    try {
      let buffer: Array<Message<T>> = []
      await fetchEventSource(fetchUrl.toString(), {
        headers,
        fetch,
        onopen: async (response: Response) => {
          this.#connected = true
          await this.#onInitialResponse(response)
        },
        onmessage: (event: EventSourceMessage) => {
          if (event.data) {
            // event.data is a single JSON object
            const schema = this.#schema! // we know that it is not undefined because it is set in onopen when we call this.#onInitialResponse
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
      if (requestAbortController.signal.aborted) {
        // During an SSE request, the fetch might have succeeded
        // and we are parsing the incoming stream.
        // If the abort happens while we're parsing the stream,
        // then it won't be caught by our `createFetchWithBackoff` wrapper
        // and instead we will get a raw AbortError here
        // which we need to turn into a `FetchBackoffAbortError`
        // such that #start handles it correctly.`
        throw new FetchBackoffAbortError()
      }
      throw error
    }
  }

  #pause() {
    if (this.#started && this.#state === `active`) {
      this.#state = `pause-requested`
      this.#requestAbortController?.abort(PAUSE_STREAM)
    }
  }

  #resume() {
    if (this.#started && this.#state === `paused`) {
      this.#start()
    }
  }

  subscribe(
    callback: (messages: Message<T>[]) => MaybePromise<void>,
    onError: (error: Error) => void = () => {}
  ) {
    const subscriptionId = Math.random()

    this.#subscribers.set(subscriptionId, [callback, onError])
    if (!this.#started) this.#start()

    return () => {
      this.#subscribers.delete(subscriptionId)
    }
  }

  unsubscribeAll(): void {
    this.#subscribers.clear()
  }

  /** Unix time at which we last synced. Undefined when `isLoading` is true. */
  lastSyncedAt(): number | undefined {
    return this.#lastSyncedAt
  }

  /** Time elapsed since last sync (in ms). Infinity if we did not yet sync. */
  lastSynced(): number {
    if (this.#lastSyncedAt === undefined) return Infinity
    return Date.now() - this.#lastSyncedAt
  }

  /** Indicates if we are connected to the Electric sync service. */
  isConnected(): boolean {
    return this.#connected
  }

  /** True during initial fetch. False afterwise.  */
  isLoading(): boolean {
    return !this.#isUpToDate
  }

  hasStarted(): boolean {
    return this.#started
  }

  isPaused(): boolean {
    return this.#state === `paused`
  }

  /** Await the next tick of the request loop */
  async #nextTick() {
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

  /** Await until we're not in the middle of a stream (i.e., until we see an up-to-date message) */
  async #waitForStreamEnd() {
    if (!this.#isMidStream) {
      return
    }
    if (this.#midStreamPromise) {
      return this.#midStreamPromise
    }
    this.#midStreamPromise = new Promise((resolve) => {
      this.#midStreamPromiseResolver = resolve
    })
    this.#midStreamPromise.finally(() => {
      this.#midStreamPromise = undefined
      this.#midStreamPromiseResolver = undefined
    })
    return this.#midStreamPromise
  }

  /**
   * Refreshes the shape stream.
   * This preemptively aborts any ongoing long poll and reconnects without
   * long polling, ensuring that the stream receives an up to date message with the
   * latest LSN from Postgres at that point in time.
   */
  async forceDisconnectAndRefresh(): Promise<void> {
    this.#isRefreshing = true
    if (this.#isUpToDate && !this.#requestAbortController?.signal.aborted) {
      // If we are "up to date", any current request will be a "live" request
      // and needs to be aborted
      this.#requestAbortController?.abort(FORCE_DISCONNECT_AND_REFRESH)
    }
    await this.#nextTick()
    this.#isRefreshing = false
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

  #subscribeToVisibilityChanges() {
    if (
      typeof document === `object` &&
      typeof document.hidden === `boolean` &&
      typeof document.addEventListener === `function`
    ) {
      const visibilityHandler = () => {
        if (document.hidden) {
          this.#pause()
        } else {
          this.#resume()
        }
      }

      document.addEventListener(`visibilitychange`, visibilityHandler)
    }
  }

  /**
   * Resets the state of the stream, optionally with a provided
   * shape handle
   */
  #reset(handle?: string) {
    this.#lastOffset = `-1`
    this.#liveCacheBuster = ``
    this.#shapeHandle = handle
    this.#isUpToDate = false
    this.#isMidStream = true
    this.#connected = false
    this.#schema = undefined
    this.#activeSnapshotRequests = 0
  }

  /**
   * Request a snapshot for subset of data.
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
    // We shouldn't be getting a snapshot on a shape that's not started
    if (!this.#started) await this.#start()

    // Wait until we're not mid-stream before pausing
    // This ensures we don't pause in the middle of a transaction
    await this.#waitForStreamEnd()

    // Pause the stream if this is the first snapshot request
    this.#activeSnapshotRequests++

    try {
      if (this.#activeSnapshotRequests === 1) {
        // Currently this cannot throw, but in case it can later it's in this try block to not have a stuck counter
        this.#pause()
      }

      const { fetchUrl, requestHeaders } = await this.#constructUrl(
        this.options.url,
        true,
        opts
      )

      const { metadata, data } = await this.#fetchSnapshot(
        fetchUrl,
        requestHeaders
      )

      const dataWithEndBoundary = (data as Array<Message<T>>).concat([
        { headers: { control: `snapshot-end`, ...metadata } },
      ])

      this.#snapshotTracker.addSnapshot(
        metadata,
        new Set(data.map((message) => message.key))
      )
      this.#onMessages(dataWithEndBoundary, false)

      return {
        metadata,
        data,
      }
    } finally {
      // Resume the stream if this was the last snapshot request
      this.#activeSnapshotRequests--
      if (this.#activeSnapshotRequests === 0) {
        this.#resume()
      }
    }
  }

  async #fetchSnapshot(url: URL, headers: Record<string, string>) {
    const response = await this.#fetchClient(url.toString(), { headers })

    if (!response.ok) {
      throw new FetchError(
        response.status,
        undefined,
        undefined,
        Object.fromEntries([...response.headers.entries()]),
        url.toString()
      )
    }

    const { metadata, data } = await response.json()
    const batch = this.#messageParser.parse<Array<ChangeMessage<T>>>(
      JSON.stringify(data),
      this.#schema!
    )

    return {
      metadata,
      data: batch,
    }
  }
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
