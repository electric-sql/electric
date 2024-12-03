import {
  Message,
  Offset,
  Schema,
  Row,
  MaybePromise,
  GetExtensions,
} from './types'
import { MessageParser, Parser } from './parser'
import { isUpToDateMessage } from './helpers'
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
  createFetchWithResponseHeadersCheck,
} from './fetch'
import {
  CHUNK_LAST_OFFSET_HEADER,
  LIVE_CACHE_BUSTER_HEADER,
  LIVE_CACHE_BUSTER_QUERY_PARAM,
  COLUMNS_QUERY_PARAM,
  LIVE_QUERY_PARAM,
  OFFSET_QUERY_PARAM,
  SHAPE_HANDLE_HEADER,
  SHAPE_HANDLE_QUERY_PARAM,
  SHAPE_SCHEMA_HEADER,
  WHERE_QUERY_PARAM,
  TABLE_QUERY_PARAM,
  REPLICA_PARAM,
} from './constants'

const RESERVED_PARAMS = new Set([
  LIVE_CACHE_BUSTER_QUERY_PARAM,
  SHAPE_HANDLE_QUERY_PARAM,
  LIVE_QUERY_PARAM,
  OFFSET_QUERY_PARAM,
])

type Replica = `full` | `default`

/**
 * PostgreSQL-specific shape parameters that can be provided externally
 */
type PostgresParams = {
  /** The root table for the shape. Not required if you set the table in your proxy. */
  table?: string

  /**
   * The columns to include in the shape.
   * Must include primary keys, and can only include valid columns.
   */
  columns?: string[]

  /** The where clauses for the shape */
  where?: string

  /**
   * If `replica` is `default` (the default) then Electric will only send the
   * changed columns in an update.
   *
   * If it's `full` Electric will send the entire row with both changed and
   * unchanged values.
   *
   * Setting `replica` to `full` will result in higher bandwidth
   * usage and so is not generally recommended.
   */
  replica?: Replica
}

type ReservedParamKeys =
  | typeof COLUMNS_QUERY_PARAM
  | typeof LIVE_CACHE_BUSTER_QUERY_PARAM
  | typeof SHAPE_HANDLE_QUERY_PARAM
  | typeof LIVE_QUERY_PARAM
  | typeof OFFSET_QUERY_PARAM
  | typeof TABLE_QUERY_PARAM
  | typeof WHERE_QUERY_PARAM
  | typeof REPLICA_PARAM

/**
 * External params type - what users provide.
 * Includes documented PostgreSQL params and allows string or string[] values for any additional params.
 */
type ExternalParamsRecord = Partial<PostgresParams> & {
  [K in string as K extends ReservedParamKeys ? never : K]: string | string[]
}

/**
 * Internal params type - used within the library.
 * All values are converted to strings.
 */
type InternalParamsRecord = {
  [K in string as K extends ReservedParamKeys ? never : K]: string
}

/**
 * Helper function to convert external params to internal format
 */
function toInternalParams(params: ExternalParamsRecord): InternalParamsRecord {
  const result: InternalParamsRecord = {}
  for (const [key, value] of Object.entries(params)) {
    result[key] = Array.isArray(value) ? value.join(`,`) : value
  }
  return result
}

type RetryOpts = {
  params?: ExternalParamsRecord
  headers?: Record<string, string>
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
   * Can be used for adding authentication headers.
   */
  headers?: Record<string, string>

  /**
   * Additional request parameters to attach to the URL.
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

  signal?: AbortSignal
  fetchClient?: typeof fetch
  backoffOptions?: BackoffOptions
  parser?: Parser<T>

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
    callback: (messages: Message<T>[]) => MaybePromise<void>,
    onError?: (error: FetchError | Error) => void
  ): void
  unsubscribeAll(): void

  isLoading(): boolean
  lastSyncedAt(): number | undefined
  lastSynced(): number
  isConnected(): boolean

  isUpToDate: boolean
  lastOffset: Offset
  shapeHandle?: string
  error?: unknown
}

/**
 * Reads updates to a shape from Electric using HTTP requests and long polling. Notifies subscribers
 * when new messages come in. Doesn't maintain any history of the
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
  readonly #messageParser: MessageParser<T>

  readonly #subscribers = new Map<
    number,
    [
      (messages: Message<T>[]) => MaybePromise<void>,
      ((error: Error) => void) | undefined,
    ]
  >()

  #lastOffset: Offset
  #liveCacheBuster: string // Seconds since our Electric Epoch 😎
  #lastSyncedAt?: number // unix time
  #isUpToDate: boolean = false
  #connected: boolean = false
  #shapeHandle?: string
  #schema?: Schema
  #onError?: ShapeStreamErrorHandler

  constructor(options: ShapeStreamOptions<GetExtensions<T>>) {
    this.options = { subscribe: true, ...options }
    validateOptions(this.options)
    this.#lastOffset = this.options.offset ?? `-1`
    this.#liveCacheBuster = ``
    this.#shapeHandle = this.options.handle
    this.#messageParser = new MessageParser<T>(options.parser)
    this.#onError = this.options.onError

    const baseFetchClient =
      options.fetchClient ??
      ((...args: Parameters<typeof fetch>) => fetch(...args))

    const fetchWithBackoffClient = createFetchWithBackoff(baseFetchClient, {
      ...(options.backoffOptions ?? BackoffDefaults),
      onFailedAttempt: () => {
        this.#connected = false
        options.backoffOptions?.onFailedAttempt?.()
      },
    })

    this.#fetchClient = createFetchWithResponseHeadersCheck(
      createFetchWithChunkBuffer(fetchWithBackoffClient)
    )

    this.#start()
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

  async #start() {
    try {
      while (
        (!this.options.signal?.aborted && !this.#isUpToDate) ||
        this.options.subscribe
      ) {
        const { url, signal } = this.options

        const fetchUrl = new URL(url)

        // Add any custom parameters first
        if (this.options.params) {
          // Check for reserved parameter names
          const reservedParams = Object.keys(this.options.params).filter(
            (key) => RESERVED_PARAMS.has(key)
          )
          if (reservedParams.length > 0) {
            throw new Error(
              `Cannot use reserved Electric parameter names in custom params: ${reservedParams.join(`, `)}`
            )
          }

          // Add PostgreSQL-specific parameters from params
          const params = toInternalParams(this.options.params)
          if (params.table)
            fetchUrl.searchParams.set(TABLE_QUERY_PARAM, params.table)
          if (params.where)
            fetchUrl.searchParams.set(WHERE_QUERY_PARAM, params.where)
          if (params.columns)
            fetchUrl.searchParams.set(COLUMNS_QUERY_PARAM, params.columns)
          if (params.replica)
            fetchUrl.searchParams.set(REPLICA_PARAM, params.replica)

          // Add any remaining custom parameters
          const customParams = { ...params }
          delete customParams.table
          delete customParams.where
          delete customParams.columns
          delete customParams.replica

          for (const [key, value] of Object.entries(customParams)) {
            fetchUrl.searchParams.set(key, value as string)
          }
        }

        // Add Electric's internal parameters
        fetchUrl.searchParams.set(OFFSET_QUERY_PARAM, this.#lastOffset)

        if (this.#isUpToDate) {
          fetchUrl.searchParams.set(LIVE_QUERY_PARAM, `true`)
          fetchUrl.searchParams.set(
            LIVE_CACHE_BUSTER_QUERY_PARAM,
            this.#liveCacheBuster
          )
        }

        if (this.#shapeHandle) {
          // This should probably be a header for better cache breaking?
          fetchUrl.searchParams.set(
            SHAPE_HANDLE_QUERY_PARAM,
            this.#shapeHandle!
          )
        }

        // sort query params in-place for stable URLs and improved cache hits
        fetchUrl.searchParams.sort()

        let response!: Response
        try {
          response = await this.#fetchClient(fetchUrl.toString(), {
            signal,
            headers: this.options.headers,
          })
          this.#connected = true
        } catch (e) {
          if (e instanceof FetchBackoffAbortError) break // interrupted
          if (!(e instanceof FetchError)) throw e // should never happen
          if (e.status == 409) {
            // Upon receiving a 409, we should start from scratch
            // with the newly provided shape handle
            const newShapeHandle = e.headers[SHAPE_HANDLE_HEADER]
            this.#reset(newShapeHandle)
            await this.#publish(e.json as Message<T>[])
            continue
          } else if (e.status >= 400 && e.status < 500) {
            // Notify subscribers
            this.#sendErrorToSubscribers(e)

            // 400 errors are not actionable without additional user input,
            // so we exit the loop
            throw e
          }
        }

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

        const messages = status === 204 ? `[]` : await response.text()

        if (status === 204) {
          // There's no content so we are live and up to date
          this.#lastSyncedAt = Date.now()
        }

        const batch = this.#messageParser.parse(messages, this.#schema)

        // Update isUpToDate
        if (batch.length > 0) {
          const lastMessage = batch[batch.length - 1]
          if (isUpToDateMessage(lastMessage)) {
            this.#lastSyncedAt = Date.now()
            this.#isUpToDate = true
          }

          await this.#publish(batch)
        }
      }
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
          this.#start()
        }
        return
      }

      // If no handler is provided for errors just throw so the error still bubbles up.
      throw err
    } finally {
      this.#connected = false
    }
  }

  subscribe(
    callback: (messages: Message<T>[]) => MaybePromise<void>,
    onError: (error: Error) => void = () => {}
  ) {
    const subscriptionId = Math.random()

    this.#subscribers.set(subscriptionId, [callback, onError])

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

  async #publish(messages: Message<T>[]): Promise<void> {
    await Promise.all(
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
  }

  #sendErrorToSubscribers(error: Error) {
    this.#subscribers.forEach(([_, errorFn]) => {
      errorFn?.(error)
    })
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
    this.#connected = false
    this.#schema = undefined
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
    !options.handle
  ) {
    throw new MissingShapeHandleError()
  }

  // Check for reserved parameter names
  if (options.params) {
    const reservedParams = Object.keys(options.params).filter((key) =>
      RESERVED_PARAMS.has(key)
    )
    if (reservedParams.length > 0) {
      throw new ReservedParamError(reservedParams)
    }
  }
  return
}
