import { v4 as uuidv4 } from 'uuid'

import { Message, JsonSerializable, Offset } from './types'

export type ShapeData = Map<string, JsonSerializable>
export type ShapeChangedCallback = (value: ShapeData) => void

// FIXME: Table needs to be qualified.
// FIXME: Shape definition will be expanded.
export type ShapeDefinition = {
  table: string
}

export interface BackoffOptions {
  initialDelay: number
  maxDelay: number
  multiplier: number
}

export interface ShapeOptions {
  baseUrl: string
  offset?: Offset
  shapeId?: string
  shape: ShapeDefinition
  backoffOptions?: BackoffOptions
}

export const BackoffDefaults = {
  initialDelay: 100,
  maxDelay: 10_000,
  multiplier: 1.3,
}

export interface ShapeStreamOptions extends ShapeOptions {
  subscribe?: boolean
  signal?: AbortSignal
}

/**
 * Recieves batches of `messages`, puts them on a queue and processes
 * them asynchronously by passing to a registered callback function.
 *
 * @constructor
 * @param {(messages: Message[]) => void} callback function
 */
class MessageProcessor {
  private messageQueue: Message[][] = []
  private isProcessing = false
  private callback: (messages: Message[]) => void | Promise<void>

  constructor(callback: (messages: Message[]) => void | Promise<void>) {
    this.callback = callback
  }

  process(messages: Message[]) {
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
 * to consume the HTTP `GET /shape` api.
 *
 * @constructor
 * @param {ShapeStreamOptions} options
 *
 * Register a callback function to subscribe to the messages.
 *
 *     const stream = new ShapeStream(options)
 *     stream.subscribe(messages => {
 *       // messages is 1 or more row updates
 *     })
 *
 * To abort the stream, abort the `signal`
 * passed in via the `ShapeStreamOptions`.
 *
 *   const aborter = new AbortController()
 *   const issueStream = new ShapeStream({
 *     shape: { table },
 *     baseUrl: `${BASE_URL}`,
 *     subscribe: true,
 *     signal: aborter.signal,
 *   })
 *   // Later...
 *   aborter.abort()
 */
export class ShapeStream {
  private options: ShapeStreamOptions
  private backoffOptions: BackoffOptions

  private subscribers = new Map<
    string,
    [MessageProcessor, ((error: Error) => void) | undefined]
  >()
  private upToDateSubscribers = new Map<
    number,
    [() => void, (error: FetchError | Error) => void]
  >()

  private lastOffset: Offset
  public hasBeenUpToDate: boolean = false
  public isUpToDate: boolean = false

  shapeId?: string

  constructor(options: ShapeStreamOptions) {
    this.validateOptions(options)
    this.options = { subscribe: true, ...options }
    this.lastOffset = this.options.offset ?? `-1`
    this.shapeId = this.options.shapeId

    this.backoffOptions = options.backoffOptions ?? BackoffDefaults

    this.start()
  }

  async start() {
    this.isUpToDate = false

    const { baseUrl, shape, signal } = this.options
    const { initialDelay, maxDelay, multiplier } = this.backoffOptions

    let attempt = 0
    let delay = initialDelay

    while ((!signal?.aborted && !this.isUpToDate) || this.options.subscribe) {
      const url = new URL(`${baseUrl}/shape/${encodeURIComponent(shape.table)}`)
      url.searchParams.set(`offset`, this.lastOffset)
      if (this.isUpToDate) {
        url.searchParams.set(`live`, `true`)
      }

      if (this.shapeId) {
        // This should probably be a header for better cache breaking?
        url.searchParams.set(`shape_id`, this.shapeId!)
      }

      try {
        await fetch(url.toString(), { signal })
          .then(async (response) => {
            if (!response.ok) {
              throw await FetchError.fromResponse(response, url.toString())
            }

            const { headers, status } = response
            const shapeId = headers.get(`X-Electric-Shape-Id`) ?? undefined
            if (shapeId) {
              this.shapeId = shapeId
            }

            attempt = 0

            if (status === 204) {
              return []
            }

            return response.json() as Promise<Message[]>
          })
          .then((batch: Message[]) => {
            // Update isUpToDate & lastOffset
            if (batch.length > 0) {
              const lastMessages = batch.slice(-2)

              lastMessages.forEach((message) => {
                if (message.headers?.[`control`] === `up-to-date`) {
                  const wasUpToDate = this.isUpToDate

                  this.isUpToDate = true

                  if (!wasUpToDate) {
                    this.hasBeenUpToDate = true

                    this.notifyUpToDateSubscribers()
                  }
                }

                if (`offset` in message) {
                  this.lastOffset = message.offset
                }
              })

              this.publish(batch)
            }
          })
      } catch (e) {
        if (signal?.aborted) {
          break
        } else if (e instanceof FetchError && e.status == 400) {
          // Notify subscribers
          this.sendErrorToUpToDateSubscribers(e)
          this.sendErrorToSubscribers(e)

          // We don't want to continue retrying on 400 errors
          break
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

  subscribe(
    callback: (messages: Message[]) => void | Promise<void>,
    onError?: (error: FetchError | Error) => void
  ) {
    const subscriptionId = uuidv4()
    const subscriber = new MessageProcessor(callback)

    this.subscribers.set(subscriptionId, [subscriber, onError])

    return () => {
      this.subscribers.delete(subscriptionId)
    }
  }

  unsubscribeAll(): void {
    this.subscribers.clear()
  }

  private publish(messages: Message[]) {
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

  private validateOptions(options: ShapeStreamOptions): void {
    if (
      !options.shape ||
      !options.shape.table ||
      typeof options.shape.table !== `string`
    ) {
      throw new Error(
        `Invalid shape option. It must be an object with a "table" property that is a string.`
      )
    }
    if (!options.baseUrl) {
      throw new Error(`Invalid shape option. It must provide the baseUrl`)
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
 * @param {ShapeOptions}
 *
 *     const shapeStream = new ShapeStream({table: `foo`, baseUrl: 'http://localhost:3000'})
 *     const shape = new Shape(shapeStream)
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
export class Shape {
  private stream: ShapeStream

  private data: ShapeData = new Map()
  private subscribers = new Map<number, ShapeChangedCallback>()
  public error: FetchError | false = false
  private hasNotifiedSubscribersUpToDate: boolean = false

  constructor(stream: ShapeStream) {
    this.stream = stream
    this.stream.subscribe(this.process.bind(this))
    const unsubscribe = this.stream.subscribeOnceToUpToDate(
      () => {
        unsubscribe()
      },
      (e) => {
        throw e
      }
    )
  }

  get isUpToDate(): boolean {
    return this.stream.isUpToDate
  }

  get value(): Promise<ShapeData> {
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

  subscribe(callback: ShapeChangedCallback): () => void {
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

  private process(messages: Message[]): void {
    let dataMayHaveChanged = false
    let isUpToDate = false
    let newlyUpToDate = false

    messages.forEach((message) => {
      if (`key` in message && message.value) {
        switch (message.headers?.[`action`]) {
          case `insert`:
          case `update`:
            this.data.set(message.key, message.value)
            dataMayHaveChanged = true

            break

          case `delete`:
            this.data.delete(message.key)
            dataMayHaveChanged = true

            break
        }
      }

      if (message.headers?.[`control`] === `up-to-date`) {
        isUpToDate = true
        if (!this.hasNotifiedSubscribersUpToDate) {
          newlyUpToDate = true
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

  private notify(): void {
    this.subscribers.forEach((callback) => {
      callback(this.valueSync)
    })
  }
}
