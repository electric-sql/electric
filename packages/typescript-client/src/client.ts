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
import { FetchError, FetchBackoffAbortError } from './error'
import {
  BackoffDefaults,
  BackoffOptions,
  createFetchWithBackoff,
  createFetchWithChunkBuffer,
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
  DATABASE_ID_QUERY_PARAM,
  TABLE_QUERY_PARAM,
  REPLICA_PARAM,
} from './constants'

type Replica = `full` | `default`

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
   * Which database to use.
   * This is optional unless Electric is used with multiple databases.
   */
  databaseId?: string

  /**
   * The root table for the shape. Passed as a query parameter. Not required if you set the table in your proxy.
   */
  table?: string

  /**
   * The where clauses for the shape.
   */
  where?: string

  /**
   * The columns to include in the shape.
   * Must include primary keys, and can only inlude valid columns.
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
  backoffOptions?: BackoffOptions

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
  signal?: AbortSignal
  fetchClient?: typeof fetch
  parser?: Parser<T>
}

export interface ShapeStreamInterface<T extends Row<unknown> = Row> {
  subscribe(
    callback: (messages: Message<T>[]) => MaybePromise<void>,
    onError?: (error: FetchError | Error) => void
  ): void
  unsubscribeAllUpToDateSubscribers(): void
  unsubscribeAll(): void
  subscribeOnceToUpToDate(
    callback: () => MaybePromise<void>,
    error: (err: FetchError | Error) => void
  ): () => void

  isLoading(): boolean
  lastSyncedAt(): number | undefined
  lastSynced(): number
  isConnected(): boolean

  isUpToDate: boolean
  shapeHandle?: string
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

  readonly #fetchClient: typeof fetch
  readonly #messageParser: MessageParser<T>

  readonly #subscribers = new Map<
    number,
    [
      (messages: Message<T>[]) => MaybePromise<void>,
      ((error: Error) => void) | undefined,
    ]
  >()
  readonly #upToDateSubscribers = new Map<
    number,
    [() => void, (error: FetchError | Error) => void]
  >()

  #lastOffset: Offset
  #liveCacheBuster: string // Seconds since our Electric Epoch 😎
  #lastSyncedAt?: number // unix time
  #isUpToDate: boolean = false
  #connected: boolean = false
  #shapeHandle?: string
  #databaseId?: string
  #schema?: Schema
  #error?: unknown
  #replica?: Replica

  constructor(options: ShapeStreamOptions<GetExtensions<T>>) {
    validateOptions(options)
    this.options = { subscribe: true, ...options }
    this.#lastOffset = this.options.offset ?? `-1`
    this.#liveCacheBuster = ``
    this.#shapeHandle = this.options.shapeHandle
    this.#databaseId = this.options.databaseId
    this.#messageParser = new MessageParser<T>(options.parser)
    this.#replica = this.options.replica

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

    this.#fetchClient = createFetchWithChunkBuffer(fetchWithBackoffClient)

    this.start()
  }

  get shapeHandle() {
    return this.#shapeHandle
  }

  get isUpToDate() {
    return this.#isUpToDate
  }

  get error() {
    return this.#error
  }

  async start() {
    this.#isUpToDate = false

    const { url, table, where, columns, signal } = this.options

    try {
      while (
        (!signal?.aborted && !this.#isUpToDate) ||
        this.options.subscribe
      ) {
        const fetchUrl = new URL(url)
        if (table) fetchUrl.searchParams.set(TABLE_QUERY_PARAM, table)
        if (where) fetchUrl.searchParams.set(WHERE_QUERY_PARAM, where)
        if (columns && columns.length > 0)
          fetchUrl.searchParams.set(COLUMNS_QUERY_PARAM, columns.join(`,`))
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

        if (this.#databaseId) {
          fetchUrl.searchParams.set(DATABASE_ID_QUERY_PARAM, this.#databaseId!)
        }

        if (
          (this.#replica ?? ShapeStream.Replica.DEFAULT) !=
          ShapeStream.Replica.DEFAULT
        ) {
          fetchUrl.searchParams.set(REPLICA_PARAM, this.#replica as string)
        }

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
            this.#sendErrorToUpToDateSubscribers(e)
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
          const prevUpToDate = this.#isUpToDate
          const lastMessage = batch[batch.length - 1]
          if (isUpToDateMessage(lastMessage)) {
            this.#lastSyncedAt = Date.now()
            this.#isUpToDate = true
          }

          await this.#publish(batch)
          if (!prevUpToDate && this.#isUpToDate) {
            this.#notifyUpToDateSubscribers()
          }
        }
      }
    } catch (err) {
      this.#error = err
    } finally {
      this.#connected = false
    }
  }

  subscribe(
    callback: (messages: Message<T>[]) => MaybePromise<void>,
    onError?: (error: FetchError | Error) => void
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

  subscribeOnceToUpToDate(
    callback: () => MaybePromise<void>,
    error: (err: FetchError | Error) => void
  ) {
    const subscriptionId = Math.random()

    this.#upToDateSubscribers.set(subscriptionId, [callback, error])

    return () => {
      this.#upToDateSubscribers.delete(subscriptionId)
    }
  }

  unsubscribeAllUpToDateSubscribers(): void {
    this.#upToDateSubscribers.clear()
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
    return !this.isUpToDate
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

  #notifyUpToDateSubscribers() {
    this.#upToDateSubscribers.forEach(([callback]) => {
      callback()
    })
  }

  #sendErrorToUpToDateSubscribers(error: FetchError | Error) {
    this.#upToDateSubscribers.forEach(([_, errorCallback]) =>
      errorCallback(error)
    )
  }

  /**
   * Resets the state of the stream, optionally with a provided
   * shape handle
   */
  #reset(shapeHandle?: string) {
    this.#lastOffset = `-1`
    this.#liveCacheBuster = ``
    this.#shapeHandle = shapeHandle
    this.#isUpToDate = false
    this.#connected = false
    this.#schema = undefined
  }
}

function validateOptions<T>(options: Partial<ShapeStreamOptions<T>>): void {
  if (!options.url) {
    throw new Error(`Invalid shape options. It must provide the url`)
  }
  if (options.signal && !(options.signal instanceof AbortSignal)) {
    throw new Error(
      `Invalid signal option. It must be an instance of AbortSignal.`
    )
  }

  if (
    options.offset !== undefined &&
    options.offset !== `-1` &&
    !options.shapeHandle
  ) {
    throw new Error(
      `shapeHandle is required if this isn't an initial fetch (i.e. offset > -1)`
    )
  }
  return
}
