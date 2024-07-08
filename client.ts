import { v4 as uuidv4 } from 'uuid'

import { Message } from './types'

export type ShapeChangedCallback = (value: Map) => void

export type ShapeData = Map

// FIXME: Table needs to be qualified.
// FIXME: Shape definition will be expanded.
export type ShapeDefinition = {
  table: string
}

export interface ShapeOptions {
  baseUrl: string
  offset?: number
  shapeId?: string
}

export interface BackoffOptions {
  initialDelay: number
  maxDelay: number
  multiplier: number
}

const BackoffDefaults = {
  initialDelay: 100,
  maxDelay: 10_000,
  multiplier: 1.3,
}

export interface ShapeStreamOptions extends ShapeOptions {
  shape: ShapeDefinition
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
 * log but does keep track of the offset position and the best way
 * to consume the HTTP `GET /shape` api.
 *
 * @constructor
 * @param {ShapeStreamOptions} options
 * @param {BackoffOptions} [backoffOptions]
 *
 * Register a callback function to subscribe to the messages and then
 * call `start()` to start consuming the stream:
 *
 *     const stream = new ShapeStream({})
 *     stream.subscribe(console.log)
 *     stream.start()
 *
 * To abruptly stop the stream, call `stop()` or abort the `signal`
 * passed in via the `ShapeStreamOptions`.
 *
 *     stream.stop() // this is final, you can't restart
 *
 * To softly pause the stream after the current fetch has finished
 * call `pause()` and then `resume()` to continue consuming from
 * the previous position without losing the shape ID and offset:
 *
 *     await stream.pause()
 *     stream.resume()
 */
export class ShapeStream {
  private options: ShapeStreamOptions
  private backoffOptions: BackoffOptions

  private instanceId: number
  private subscribers: Map = new Map<string, MessageProcessor>()
  private upToDateSubscribers: Map = new Map<string, () => void>()

  private closedPromise: Promise<unknown>
  private outsideResolve?: (value?: unknown) => void

  private pausedPromise?: Promise<unknown>
  private pausedResolve?: (value?: unknown) => void

  private lastOffset: Number
  private hasBeenUpToDate: Boolean = false
  private isUpToDate: Boolean = false

  private isPaused: Boolean = false
  private shouldPause: Boolean = false

  private liveMode: Boolean

  shapeId?: string

  constructor(
    options: ShapeStreamOptions,
    backoffOptions: BackoffOptions = BackoffDefaults
  ) {
    this.instanceId = Math.random()

    this.validateOptions(options)
    this.options = { subscribe: true, ...options }
    this.lastOffset = this.options.offset || -1
    this.shapeId = this.options.shapeId
    this.liveMode = options.subscribe

    this.backoffOptions = backoffOptions

    this.outsideResolve
    this.closedPromise = new Promise((resolve) => {
      this.outsideResolve = resolve
    })
  }

  setLiveMode(value: Boolean) {
    this.liveMode = value
  }

  async start() {
    this.isPaused = false
    this.isUpToDate = false

    const { baseUrl, shape, signal, subscribe } = this.options
    const { initialDelay, maxDelay, multiplier } = this.backoffOptions

    let attempt = 0
    let delay = initialDelay

    while ((!signal?.aborted && !this.isUpToDate) || this.liveMode) {
      if (this.shouldPause) {
        this.isPaused = true
        this.shouldPause = false

        this.pausedResolve()
      }
      if (this.isPaused) {
        break
      }

      const url = new URL(`${baseUrl}/shape/${shape.table}`)
      url.searchParams.set(`offset`, this.lastOffset.toString())
      url.searchParams.set(this.isUpToDate ? `live` : `notLive`, ``)
      // This should probably be a header for better cache breaking?
      url.searchParams.set(`shapeId`, this.shapeId!)

      try {
        await fetch(url.toString(), { signal })
          .then(async (response) => {
            if (!response.ok) {
              throw new Error(`HTTP error! Status: ${response.status}`)
            }

            const { headers, status } = response
            this.shapeId = headers.get(`x-electric-shape-id`) ?? undefined

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
          // Break out of while loop when the user aborts the client.
          this.isPaused = false

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

    if (!this.isPaused) {
      this.outsideResolve && this.outsideResolve()
    }
  }

  async stop() {
    const { signal } = this.options

    signal?.abort()

    return this.closedPromise
  }

  async pause() {
    this.pausedPromise = new Promise((resolve) => {
      this.pausedResolve = resolve
    })

    this.shouldPause = true

    return pausedPromise
  }

  async resume() {
    return this.start()
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
 * @param {ShapeDefinition}
 * @param {ShapeOptions}
 *
 *     const shape = new Shape({table: 'items'}, {baseUrl: 'http://localhost:3000'})
 *
 * Start syncing data:
 *
 *     const value = await shape.sync()
 *
 * Or to sync one time:
 *
 *     const value = await shape.syncOnce()
 *
 * Every time you call `syncOnce` it catches up to the latest data:
 *
 *     let value = await shape.syncOnce()
 *     // ... time passes ...
 *     value = await shape.syncOnce()
 *
 * `isUpToDate` resolves every time the shape is up-to-date again:
 *
 *     const value = await shape.isUpToDate
 *
 * `hasSyncedOnce ` resolves when the shape has been up-to-date once:
 *
 *     const value = await shape.hasSyncedOnce
 *
 * So if you want to write a component that blocks on the initial sync but
 * renders immediately thereafter:
 *
 *     shape.sync()
 *     await shape.hasSyncedOnce
 *
 * Or if you want a component that always blocks on syncing the latest data:
 *
 *     await shape.sync()
 *
 * Equivalent to:
 *
 *     shape.sync()
 *     await shape.isUpToDate
 *
 * To stop syncing and teardown subscriptions, etc.
 *
 *     shape.stop()
 */
export class Shape {
  private aborter: AbortController
  private definition: ShapeDefinition
  private stream: ShapeStream

  private data: ShapeData = new Map()
  private subscribers = new Map<string, ShapeChangedCallback>()

  private isSyncing = false

  constructor(
    definition: ShapeDefinition,
    options: ShapeOptions,
    backoffOptions?: BackoffOptions
  ) {
    this.aborter = new AbortController()
    this.definition = definition

    const streamOptions = {
      ...options,
      shape: definition,
      signal: this.aborter.signal,
    }

    this.stream = new ShapeStream(streamOptions, backoffOptions)
    this.stream.subscribe(this.process.bind(this))
  }

  get id() {
    return this.stream.shapeId
  }
  get value() {
    return this.data
  }

  get hasSyncedOnce(): Promise<Map> {
    return new Promise((resolve) => {
      if (this.stream.hasBeenUpToDate) {
        resolve(this.value)
      } else {
        this.stream.subscribeOnceToUpToDate(() => {
          resolve(this.value)
        })
      }
    })
  }

  get isUpToDate(): Promise<Map> {
    return new Promise((resolve) => {
      if (this.stream.isUpToDate) {
        resolve(this.value)
      } else {
        this.stream.subscribeOnceToUpToDate(() => {
          resolve(this.value)
        })
      }
    })
  }

  async sync(): ShapeData {
    this.stream.setLiveMode(true)

    if (!this.isSyncing) {
      this.isSyncing = true

      this.stream.start().then(() => {
        this.isSyncing = false
      })
    }

    return this.isUpToDate
  }

  async syncOnce(): ShapeData {
    this.stream.setLiveMode(false)

    if (!this.isSyncing) {
      this.isSyncing = true

      this.stream.start().then(() => {
        this.isSyncing = false
      })
    }

    return this.hasSyncedOnce
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

  async stop() {
    this.stream.stop()
  }

  private process(messages: Message[]): void {
    let dataMayHaveChanged = false
    let isUpToDate = false

    messages.forEach((message) => {
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
