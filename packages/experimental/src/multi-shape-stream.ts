import { ShapeStream } from '@electric-sql/client'
import type {
  ChangeMessage,
  ControlMessage,
  FetchError,
  MaybePromise,
  Row,
  ShapeStreamOptions,
} from '@electric-sql/client'

type InferShapeTypes<T> = {
  [K in keyof T]: T[K] extends ShapeStreamOptions<infer R extends Row<unknown>>
    ? R
    : T[K] extends ShapeStream<infer R extends Row<unknown>>
      ? R
      : never
}

interface MultiShapeStreamOptions<
  TShapes extends {
    [K: string]: ShapeStreamOptions<Row<unknown>> | ShapeStream<Row<unknown>>
  } = {
    [K: string]: ShapeStreamOptions<Row<unknown>> | ShapeStream<Row<unknown>>
  },
> {
  shapes: TShapes
  start?: boolean
  checkForUpdatesAfter?: number // milliseconds
}

interface MultiShapeChangeMessage<
  T extends Row<unknown>,
  ShapeNames extends string,
> extends ChangeMessage<T> {
  shape: ShapeNames
}

interface MultiShapeControlMessage<ShapeNames extends string>
  extends ControlMessage {
  shape: ShapeNames
}

type MultiShapeMessage<T extends Row<unknown>, ShapeNames extends string> =
  | MultiShapeChangeMessage<T, ShapeNames>
  | MultiShapeControlMessage<ShapeNames>

type MultiShapeMessages<
  TShapes extends {
    [K: string]: ShapeStreamOptions<Row<unknown>> | ShapeStream<Row<unknown>>
  },
> = {
  [K in keyof TShapes & string]: MultiShapeMessage<
    InferShapeTypes<TShapes>[K],
    K
  >
}

interface MultiShapeStreamInterface<
  TShapes extends {
    [K: string]: ShapeStreamOptions<Row<unknown>> | ShapeStream<Row<unknown>>
  },
> {
  shapes: { [K in keyof TShapes]: ShapeStream<InferShapeTypes<TShapes>[K]> }
  checkForUpdatesAfter?: number

  subscribe(
    callback: (messages: MultiShapeMessages<TShapes>[]) => MaybePromise<void>,
    onError?: (error: FetchError | Error) => void
  ): () => void
  unsubscribeAll(): void

  lastSyncedAt(): number | undefined
  lastSynced(): number
  isConnected(): boolean
  isLoading(): boolean

  isUpToDate: boolean
}

/**
 * A multi-shape stream is a stream that can subscribe to multiple shapes.
 * It ensures that all shapes will receive at least an `up-to-date` message from
 * Electric within the `checkForUpdatesAfter` interval.
 *
 * @constructor
 * @param {MultiShapeStreamOptions} options - configure the multi-shape stream
 * @example
 * ```ts
 * const multiShapeStream = new MultiShapeStream({
 *   shapes: {
 *     shape1: {
 *       url: 'http://localhost:3000/v1/shape1',
 *     },
 *     shape2: {
 *       url: 'http://localhost:3000/v1/shape2',
 *     },
 *   },
 * })
 * ```
 */

export class MultiShapeStream<
  TShapes extends {
    [K: string]: ShapeStreamOptions<Row<unknown>> | ShapeStream<Row<unknown>>
  },
> implements MultiShapeStreamInterface<TShapes>
{
  #shapes: { [K in keyof TShapes]: ShapeStream<InferShapeTypes<TShapes>[K]> }
  #started = false
  checkForUpdatesAfter?: number

  #checkForUpdatesTimeout?: ReturnType<typeof setTimeout> | undefined
  #shapesToSkipCheckForUpdates = new Set<keyof TShapes>()

  readonly #subscribers = new Map<
    number,
    [
      (messages: MultiShapeMessages<TShapes>[]) => MaybePromise<void>,
      ((error: Error) => void) | undefined,
    ]
  >()

  constructor(options: MultiShapeStreamOptions<TShapes>) {
    const {
      start = true, // By default we start the multi-shape stream
      checkForUpdatesAfter = 100, // Force a check for updates after 100ms
      shapes,
    } = options
    this.checkForUpdatesAfter = checkForUpdatesAfter
    this.#shapes = Object.fromEntries(
      Object.entries(shapes).map(([key, shape]) => [
        key,
        shape instanceof ShapeStream
          ? shape
          : new ShapeStream<InferShapeTypes<TShapes>[typeof key]>(shape as any),
      ])
    ) as { [K in keyof TShapes]: ShapeStream<InferShapeTypes<TShapes>[K]> }
    if (start) this.#start()
  }

  #start() {
    if (this.#started) throw new Error(`Cannot start multi-shape stream twice`)
    for (const [key, shape] of this.#shapeEntries()) {
      if (shape.hasStarted()) {
        // The multi-shape stream needs to be started together as a whole, and so we
        // have to check that a shape is not already started.
        throw new Error(`Shape ${key} already started`)
      }
      shape.subscribe(
        async (messages) => {
          this.#scheduleCheckForUpdates(key)
          const multiShapeMessages = messages.map(
            (message) =>
              ({
                ...message,
                shape: key,
              }) as MultiShapeMessages<TShapes>
          )
          await this.#publish(multiShapeMessages)
        },
        (error) => this.#onError(error)
      )
    }
  }

  #scheduleCheckForUpdates(fromShape: keyof TShapes) {
    this.#shapesToSkipCheckForUpdates.add(fromShape)
    this.#checkForUpdatesTimeout ??= setTimeout(() => {
      this.#checkForUpdates()
      this.#checkForUpdatesTimeout = undefined
    }, this.checkForUpdatesAfter)
  }

  async #checkForUpdates() {
    const refreshPromises = this.#shapeEntries()
      .filter(([key]) => !this.#shapesToSkipCheckForUpdates.has(key))
      .map(([_, shape]) => {
        return shape.forceDisconnectAndRefresh()
      })
    this.#shapesToSkipCheckForUpdates.clear()
    await Promise.all(refreshPromises)
  }

  #onError(error: Error) {
    // TODO: we probably want to disconnect all shapes here on the first error
    this.#subscribers.forEach(([_, errorFn]) => {
      errorFn?.(error)
    })
  }

  async #publish(messages: MultiShapeMessages<TShapes>[]): Promise<void> {
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

  /**
   * Returns an array of the shape entries.
   * Ensures that the shape entries are typed, as `Object.entries`
   * will not type the entries correctly.
   */
  #shapeEntries() {
    return Object.entries(this.#shapes) as [
      keyof TShapes & string,
      ShapeStream<InferShapeTypes<TShapes>[string]>,
    ][]
  }

  /**
   * The ShapeStreams that are being subscribed to.
   */
  get shapes() {
    return this.#shapes
  }

  subscribe(
    callback: (messages: MultiShapeMessages<TShapes>[]) => MaybePromise<void>,
    onError?: (error: FetchError | Error) => void
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
    // Min of all the lastSyncedAt values
    return Math.min(
      ...this.#shapeEntries().map(([_, shape]) => shape.lastSyncedAt() ?? Infinity)
    )
  }

  /** Time elapsed since last sync (in ms). Infinity if we did not yet sync. */
  lastSynced(): number {
    const lastSyncedAt = this.lastSyncedAt()
    if (lastSyncedAt === undefined) return Infinity
    return Date.now() - lastSyncedAt
  }

  /** Indicates if we are connected to the Electric sync service. */
  isConnected(): boolean {
    return this.#shapeEntries().every(([_, shape]) => shape.isConnected())
  }

  /** True during initial fetch. False afterwise. */
  isLoading(): boolean {
    return this.#shapeEntries().some(([_, shape]) => shape.isLoading())
  }

  get isUpToDate() {
    return this.#shapeEntries().every(([_, shape]) => shape.isUpToDate)
  }
}
