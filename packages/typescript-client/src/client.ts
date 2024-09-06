import { Message, Offset, Schema, Row } from './types'
import { MessageParser, Parser } from './parser'
import { isChangeMessage, isControlMessage } from './helpers'

export type ShapeData<T extends Row = Row> = Map<string, T>
export type ShapeChangedCallback<T extends Row = Row> = (
  value: ShapeData<T>
) => void

export interface BackoffOptions {
  initialDelay: number
  maxDelay: number
  multiplier: number
}

export const BackoffDefaults = {
  initialDelay: 100,
  maxDelay: 10_000,
  multiplier: 1.3,
}

/**
 * Options for constructing a ShapeStream.
 */
export interface ShapeStreamOptions {
  /**
   * The full URL to where the Shape is hosted. This can either be the Electric server
   * directly or a proxy. E.g. for a local Electric instance, you might set `http://localhost:3000/v1/shape/foo`
   */
  url: string
  /**
   * where clauses for the shape.
   */
  where?: string
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
  backoffOptions?: BackoffOptions
  /**
   * Automatically fetch updates to the Shape. If you just want to sync the current
   * shape and stop, pass false.
   */
  subscribe?: boolean
  signal?: AbortSignal
  fetchClient?: typeof fetch
  parser?: Parser
}

/**
 * Receives batches of `messages`, puts them on a queue and processes
 * them asynchronously by passing to a registered callback function.
 *
 * @constructor
 * @param {(messages: Message[]) => void} callback function
 */
class MessageProcessor<T extends Row = Row> {
  private messageQueue: Message<T>[][] = []
  private isProcessing = false
  private callback: (messages: Message<T>[]) => void | Promise<void>

  constructor(callback: (messages: Message<T>[]) => void | Promise<void>) {
    this.callback = callback
  }

  process(messages: Message<T>[]) {
    this.messageQueue.push(messages)

    if (!this.isProcessing) {
      this.processQueue()
    }
  }

  private async processQueue() {
    this.isProcessing = true

    while (this.messageQueue.length > 0) {
      const messages = this.messageQueue.shift()!

      await this.callback(messages)
    }

    this.isProcessing = false
  }
}

export class FetchError extends Error {
  status: number
  text?: string
  json?: object
  headers: Record<string, string>

  constructor(
    status: number,
    text: string | undefined,
    json: object | undefined,
    headers: Record<string, string>,
    public url: string,
    message?: string
  ) {
    super(
      message ||
        `HTTP Error ${status} at ${url}: ${text ?? JSON.stringify(json)}`
    )
    this.name = `FetchError`
    this.status = status
    this.text = text
    this.json = json
    this.headers = headers
  }

  static async fromResponse(
    response: Response,
    url: string
  ): Promise<FetchError> {
    const status = response.status
    const headers = Object.fromEntries([...response.headers.entries()])
    let text: string | undefined = undefined
    let json: object | undefined = undefined

    const contentType = response.headers.get(`content-type`)
    if (contentType && contentType.includes(`application/json`)) {
      json = (await response.json()) as object
    } else {
      text = await response.text()
    }

    return new FetchError(status, text, json, headers, url)
  }
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
export class ShapeStream<T extends Row = Row> {
  private options: ShapeStreamOptions
  private backoffOptions: BackoffOptions
  private fetchClient: typeof fetch
  private schema?: Schema

  private subscribers = new Map<
    number,
    [MessageProcessor<T>, ((error: Error) => void) | undefined]
  >()
  private upToDateSubscribers = new Map<
    number,
    [() => void, (error: FetchError | Error) => void]
  >()

  private lastOffset: Offset
  private messageParser: MessageParser<T>
  private lastSyncedAt?: number // unix time
  public isUpToDate: boolean = false
  private connected: boolean = false

  shapeId?: string

  constructor(options: ShapeStreamOptions) {
    this.validateOptions(options)
    this.options = { subscribe: true, ...options }
    this.lastOffset = this.options.offset ?? `-1`
    this.shapeId = this.options.shapeId
    this.messageParser = new MessageParser<T>(options.parser)

    this.backoffOptions = options.backoffOptions ?? BackoffDefaults
    this.fetchClient =
      options.fetchClient ??
      ((...args: Parameters<typeof fetch>) => fetch(...args))

    this.start()
  }

  async start() {
    this.isUpToDate = false

    const { url, where, signal } = this.options

    try {
      while ((!signal?.aborted && !this.isUpToDate) || this.options.subscribe) {
        const fetchUrl = new URL(url)
        if (where) fetchUrl.searchParams.set(`where`, where)
        fetchUrl.searchParams.set(`offset`, this.lastOffset)

        if (this.isUpToDate) {
          fetchUrl.searchParams.set(`live`, `true`)
        }

        if (this.shapeId) {
          // This should probably be a header for better cache breaking?
          fetchUrl.searchParams.set(`shape_id`, this.shapeId!)
        }

        let response!: Response

        try {
          const maybeResponse = await this.fetchWithBackoff(fetchUrl)
          if (maybeResponse) response = maybeResponse
          else break
        } catch (e) {
          if (!(e instanceof FetchError)) throw e // should never happen
          if (e.status == 409) {
            // Upon receiving a 409, we should start from scratch
            // with the newly provided shape ID
            const newShapeId = e.headers[`x-electric-shape-id`]
            this.reset(newShapeId)
            this.publish(e.json as Message<T>[])
            continue
          } else if (e.status >= 400 && e.status < 500) {
            // Notify subscribers
            this.sendErrorToUpToDateSubscribers(e)
            this.sendErrorToSubscribers(e)

            // 400 errors are not actionable without additional user input, so we're throwing them.
            throw e
          }
        }

        const { headers, status } = response
        const shapeId = headers.get(`X-Electric-Shape-Id`)
        if (shapeId) {
          this.shapeId = shapeId
        }

        const lastOffset = headers.get(`X-Electric-Chunk-Last-Offset`)
        if (lastOffset) {
          this.lastOffset = lastOffset as Offset
        }

        const getSchema = (): Schema => {
          const schemaHeader = headers.get(`X-Electric-Schema`)
          return schemaHeader ? JSON.parse(schemaHeader) : {}
        }
        this.schema = this.schema ?? getSchema()

        const messages = status === 204 ? `[]` : await response.text()

        if (status === 204) {
          // There's no content so we are live and up to date
          this.lastSyncedAt = Date.now()
        }

        const batch = this.messageParser.parse(messages, this.schema)

        // Update isUpToDate
        if (batch.length > 0) {
          const lastMessage = batch[batch.length - 1]
          if (
            isControlMessage(lastMessage) &&
            lastMessage.headers.control === `up-to-date`
          ) {
            this.lastSyncedAt = Date.now()
            if (!this.isUpToDate) {
              this.isUpToDate = true
              this.notifyUpToDateSubscribers()
            }
          }

          this.publish(batch)
        }
      }
    } finally {
      this.connected = false
    }
  }

  subscribe(
    callback: (messages: Message<T>[]) => void | Promise<void>,
    onError?: (error: FetchError | Error) => void
  ) {
    const subscriptionId = Math.random()
    const subscriber = new MessageProcessor(callback)

    this.subscribers.set(subscriptionId, [subscriber, onError])

    return () => {
      this.subscribers.delete(subscriptionId)
    }
  }

  unsubscribeAll(): void {
    this.subscribers.clear()
  }

  private publish(messages: Message<T>[]) {
    this.subscribers.forEach(([subscriber, _]) => {
      subscriber.process(messages)
    })
  }

  private sendErrorToSubscribers(error: Error) {
    this.subscribers.forEach(([_, errorFn]) => {
      errorFn?.(error)
    })
  }

  subscribeOnceToUpToDate(
    callback: () => void | Promise<void>,
    error: (err: FetchError | Error) => void
  ) {
    const subscriptionId = Math.random()

    this.upToDateSubscribers.set(subscriptionId, [callback, error])

    return () => {
      this.upToDateSubscribers.delete(subscriptionId)
    }
  }

  unsubscribeAllUpToDateSubscribers(): void {
    this.upToDateSubscribers.clear()
  }

  /** Time elapsed since last sync (in ms). Infinity if we did not yet sync. */
  lastSynced(): number {
    if (this.lastSyncedAt === undefined) return Infinity
    return Date.now() - this.lastSyncedAt
  }

  isConnected(): boolean {
    return this.connected
  }

  private notifyUpToDateSubscribers() {
    this.upToDateSubscribers.forEach(([callback]) => {
      callback()
    })
  }

  private sendErrorToUpToDateSubscribers(error: FetchError | Error) {
    // eslint-disable-next-line
    this.upToDateSubscribers.forEach(([_, errorCallback]) =>
      errorCallback(error)
    )
  }

  /**
   * Resets the state of the stream, optionally with a provided
   * shape ID
   */
  private reset(shapeId?: string) {
    this.lastOffset = `-1`
    this.shapeId = shapeId
    this.isUpToDate = false
    this.connected = false
    this.schema = undefined
  }

  private validateOptions(options: ShapeStreamOptions): void {
    if (!options.url) {
      throw new Error(`Invalid shape option. It must provide the url`)
    }
    if (options.signal && !(options.signal instanceof AbortSignal)) {
      throw new Error(
        `Invalid signal option. It must be an instance of AbortSignal.`
      )
    }

    if (
      options.offset !== undefined &&
      options.offset !== `-1` &&
      !options.shapeId
    ) {
      throw new Error(
        `shapeId is required if this isn't an initial fetch (i.e. offset > -1)`
      )
    }
  }

  private async fetchWithBackoff(url: URL) {
    const { initialDelay, maxDelay, multiplier } = this.backoffOptions
    const signal = this.options.signal

    let delay = initialDelay
    let attempt = 0

    // eslint-disable-next-line no-constant-condition -- we're retrying with a lag until we get a non-500 response or the abort signal is triggered
    while (true) {
      try {
        const result = await this.fetchClient(url.toString(), { signal })
        if (result.ok) {
          this.connected = true
          return result
        } else throw await FetchError.fromResponse(result, url.toString())
      } catch (e) {
        this.connected = false
        if (signal?.aborted) {
          return undefined
        } else if (
          e instanceof FetchError &&
          e.status >= 400 &&
          e.status < 500
        ) {
          // Any client errors cannot be backed off on, leave it to the caller to handle.
          throw e
        } else {
          // Exponentially backoff on errors.
          // Wait for the current delay duration
          await new Promise((resolve) => setTimeout(resolve, delay))

          // Increase the delay for the next attempt
          delay = Math.min(delay * multiplier, maxDelay)

          attempt++
          console.log(`Retry attempt #${attempt} after ${delay}ms`)
        }
      }
    }
  }
}

/**
 * A Shape is an object that subscribes to a shape log,
 * keeps a materialised shape `.value` in memory and
 * notifies subscribers when the value has changed.
 *
 * It can be used without a framework and as a primitive
 * to simplify developing framework hooks.
 *
 * @constructor
 * @param {ShapeStream<T extends Row>} - the underlying shape stream
 * @example
 * ```
 * const shapeStream = new ShapeStream<{ foo: number }>(url: 'http://localhost:3000/v1/shape/foo'})
 * const shape = new Shape(shapeStream)
 * ```
 *
 * `value` returns a promise that resolves the Shape data once the Shape has been
 * fully loaded (and when resuming from being offline):
 *
 *     const value = await shape.value
 *
 * `valueSync` returns the current data synchronously:
 *
 *     const value = shape.valueSync
 *
 *  Subscribe to updates. Called whenever the shape updates in Postgres.
 *
 *     shape.subscribe(shapeData => {
 *       console.log(shapeData)
 *     })
 */
export class Shape<T extends Row = Row> {
  private stream: ShapeStream<T>

  private data: ShapeData<T> = new Map()
  private subscribers = new Map<number, ShapeChangedCallback<T>>()
  public error: FetchError | false = false
  private hasNotifiedSubscribersUpToDate: boolean = false

  constructor(stream: ShapeStream<T>) {
    this.stream = stream
    this.stream.subscribe(this.process.bind(this), this.handleError.bind(this))
    const unsubscribe = this.stream.subscribeOnceToUpToDate(
      () => {
        unsubscribe()
      },
      (e) => {
        this.handleError(e)
        throw e
      }
    )
  }

  get isUpToDate(): boolean {
    return this.stream.isUpToDate
  }

  lastSynced(): number {
    return this.stream.lastSynced()
  }

  isConnected(): boolean {
    return this.stream.isConnected()
  }

  get value(): Promise<ShapeData<T>> {
    return new Promise((resolve) => {
      if (this.stream.isUpToDate) {
        resolve(this.valueSync)
      } else {
        const unsubscribe = this.stream.subscribeOnceToUpToDate(
          () => {
            unsubscribe()
            resolve(this.valueSync)
          },
          (e) => {
            throw e
          }
        )
      }
    })
  }

  get valueSync() {
    return this.data
  }

  subscribe(callback: ShapeChangedCallback<T>): () => void {
    const subscriptionId = Math.random()

    this.subscribers.set(subscriptionId, callback)

    return () => {
      this.subscribers.delete(subscriptionId)
    }
  }

  unsubscribeAll(): void {
    this.subscribers.clear()
  }

  get numSubscribers() {
    return this.subscribers.size
  }

  private process(messages: Message<T>[]): void {
    let dataMayHaveChanged = false
    let isUpToDate = false
    let newlyUpToDate = false

    messages.forEach((message) => {
      if (isChangeMessage(message)) {
        dataMayHaveChanged = [`insert`, `update`, `delete`].includes(
          message.headers.operation
        )

        switch (message.headers.operation) {
          case `insert`:
            this.data.set(message.key, message.value)
            break
          case `update`:
            this.data.set(message.key, {
              ...this.data.get(message.key)!,
              ...message.value,
            })
            break
          case `delete`:
            this.data.delete(message.key)
            break
        }
      }

      if (isControlMessage(message)) {
        switch (message.headers.control) {
          case `up-to-date`:
            isUpToDate = true
            if (!this.hasNotifiedSubscribersUpToDate) {
              newlyUpToDate = true
            }
            break
          case `must-refetch`:
            this.data.clear()
            this.error = false
            isUpToDate = false
            newlyUpToDate = false
            break
        }
      }
    })

    // Always notify subscribers when the Shape first is up to date.
    // FIXME this would be cleaner with a simple state machine.
    if (newlyUpToDate || (isUpToDate && dataMayHaveChanged)) {
      this.hasNotifiedSubscribersUpToDate = true
      this.notify()
    }
  }

  private handleError(e: Error): void {
    if (e instanceof FetchError) {
      this.error = e
      this.notify()
    }
  }

  private notify(): void {
    this.subscribers.forEach((callback) => {
      callback(this.valueSync)
    })
  }
}
