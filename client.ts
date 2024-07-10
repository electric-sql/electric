import { v4 as uuidv4 } from 'uuid'

import { Message, JsonSerializable } from './types'

export type ShapeData = Map<string, JsonSerializable>
export type ShapeChangedCallback = (value: ShapeData) => void

// FIXME: Table needs to be qualified.
// FIXME: Shape definition will be expanded.
export type ShapeDefinition = {
  table: string
}

export interface ShapeOptions {
  baseUrl: string
  offset?: number
  shapeId?: string
  shape: ShapeDefinition
}

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

export interface ShapeStreamOptions extends ShapeOptions {
  subscribe?: boolean
  signal?: AbortSignal
}

/*
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

/*
 * Consumes a shape stream using long polling. Notifies subscribers
 * when new messages come in. Doesn't maintain any history of the
 * log but does keep track of the offset position and is the best way
 * to consume the HTTP `GET /shape` api.
 *
 * @constructor
 * @param {ShapeStreamOptions} options
 * @param {BackoffOptions} [backoffOptions]
 *
 * Register a callback function to subscribe to the messages.
 *
 *     const stream = new ShapeStream({})
 *     stream.subscribe(console.log)
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

  private subscribers = new Map<string, MessageProcessor>()
  private upToDateSubscribers = new Map<string, () => void>()

  private lastOffset: number
  public hasBeenUpToDate: boolean = false
  public isUpToDate: boolean = false

  shapeId?: string

  constructor(
    options: ShapeStreamOptions,
    backoffOptions: BackoffOptions = BackoffDefaults
  ) {
    this.validateOptions(options)
    this.options = { subscribe: true, ...options }
    this.lastOffset = this.options.offset || -1
    this.shapeId = this.options.shapeId

    this.backoffOptions = backoffOptions

    this.start()
  }

  async start() {
    this.isUpToDate = false

    const { baseUrl, shape, signal } = this.options
    const { initialDelay, maxDelay, multiplier } = this.backoffOptions

    let attempt = 0
    let delay = initialDelay

    while ((!signal?.aborted && !this.isUpToDate) || this.options.subscribe) {
      const url = new URL(`${baseUrl}/shape/${shape.table}`)
      url.searchParams.set(`offset`, this.lastOffset.toString())
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
              throw new Error(`HTTP error! Status: ${response.status}`)
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

            return response.json()
          })
          .then((batch: Message[]) => {
            this.publish(batch)

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

                if (typeof message.offset !== `undefined`) {
                  this.lastOffset = message.offset
                }
              })
            }
          })
      } catch (e) {
        if (signal?.aborted) {
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

  subscribe(callback: (messages: Message[]) => void | Promise<void>) {
    const subscriptionId = uuidv4()
    const subscriber = new MessageProcessor(callback)

    this.subscribers.set(subscriptionId, subscriber)

    return () => {
      this.subscribers.delete(subscriptionId)
    }
  }

  unsubscribeAll(): void {
    this.subscribers.clear()
  }

  private publish(messages: Message[]) {
    this.subscribers.forEach((subscriber) => {
      subscriber.process(messages)
    })
  }

  subscribeOnceToUpToDate(callback: () => void | Promise<void>) {
    const subscriptionId = uuidv4()

    this.upToDateSubscribers.set(subscriptionId, callback)

    return () => {
      this.upToDateSubscribers.delete(subscriptionId)
    }
  }

  unsubscribeAllUpToDateSubscribers(): void {
    this.upToDateSubscribers.clear()
  }

  private notifyUpToDateSubscribers() {
    this.upToDateSubscribers.forEach((callback) => {
      callback()
    })
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
      options.offset > -1 &&
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
 *     const shape = new Shape({table: `foo`, baseUrl: 'http://localhost:3000'})
 *
 * `isUpToDate` resolves once the Shape has been fully loaded (and when resuming from being offline):
 *
 *     const value = await shape.isUpToDate
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
  private subscribers = new Map<string, ShapeChangedCallback>()

  constructor(options: ShapeOptions, backoffOptions?: BackoffOptions) {
    this.stream = new ShapeStream(options, backoffOptions)
    this.stream.subscribe(this.process.bind(this))
  }

  get value() {
    return this.data
  }

  get isUpToDate(): Promise<ShapeData> {
    return new Promise((resolve) => {
      if (this.stream.isUpToDate) {
        resolve(this.value)
      } else {
        const unsubscribe = this.stream.subscribeOnceToUpToDate(() => {
          unsubscribe()
          resolve(this.value)
        })
      }
    })
  }

  subscribe(callback: ShapeChangedCallback): () => void {
    const subscriptionId = uuidv4()

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

    messages.forEach((message) => {
      if (message.key && message.value) {
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
      }
    })

    if (isUpToDate && dataMayHaveChanged) {
      this.notify()
    }
  }

  private notify(): void {
    this.subscribers.forEach((callback) => {
      callback(this.value)
    })
  }
}
