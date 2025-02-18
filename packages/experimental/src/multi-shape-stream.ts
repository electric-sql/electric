import { ShapeStream } from '@electric-sql/client'
import type {
  ChangeMessage,
  ControlMessage,
  FetchError,
  MaybePromise,
  Row,
  ShapeStreamOptions,
} from '@electric-sql/client'

interface MultiShapeStreamOptions<
  TShapeRows extends {
    [K: string]: Row<unknown>
  } = {
    [K: string]: Row<unknown>
  },
> {
  shapes: {
    [K in keyof TShapeRows]: ShapeStreamOptions<TShapeRows[K]> | ShapeStream<TShapeRows[K]>
  }
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

export type MultiShapeMessages<
TShapeRows extends {
    [K: string]: Row<unknown>
  },
> = {
  [K in keyof TShapeRows & string]: MultiShapeMessage<
    TShapeRows[K],
    K
  >
}[keyof TShapeRows & string]

interface MultiShapeStreamInterface<
  TShapeRows extends {
    [K: string]: Row<unknown>
  },
> {
  shapes: { [K in keyof TShapeRows]: ShapeStream<TShapeRows[K]> }
  checkForUpdatesAfter?: number

  subscribe(
    callback: (messages: MultiShapeMessages<TShapeRows>[]) => MaybePromise<void>,
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
  TShapeRows extends {
    [K: string]: Row<unknown>
  },
> implements MultiShapeStreamInterface<TShapeRows>
{
  #shapes: { [K in keyof TShapeRows]: ShapeStream<TShapeRows[K]> }
  #started = false
  checkForUpdatesAfter?: number

  #checkForUpdatesTimeout?: ReturnType<typeof setTimeout> | undefined
  #shapesToSkipCheckForUpdates = new Set<keyof TShapeRows>()

  readonly #subscribers = new Map<
    number,
    [
      (messages: MultiShapeMessages<TShapeRows>[]) => MaybePromise<void>,
      ((error: Error) => void) | undefined,
    ]
  >()

  constructor(options: MultiShapeStreamOptions<TShapeRows>) {
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
          : new ShapeStream<TShapeRows[typeof key]>({
            ...shape,
            start: false,
          } as any),
      ])
    ) as { [K in keyof TShapeRows]: ShapeStream<TShapeRows[K]> }
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
              }) as MultiShapeMessages<TShapeRows>
          )
          await this.#publish(multiShapeMessages)
        },
        (error) => this.#onError(error)
      )
    }
    this.#started = true
  }

  #scheduleCheckForUpdates(fromShape: keyof TShapeRows) {
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

  async #publish(messages: MultiShapeMessages<TShapeRows>[]): Promise<void> {
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
      keyof TShapeRows & string,
      ShapeStream<TShapeRows[string]>,
    ][]
  }

  /**
   * The ShapeStreams that are being subscribed to.
   */
  get shapes() {
    return this.#shapes
  }

  subscribe(
    callback: (messages: MultiShapeMessages<TShapeRows>[]) => MaybePromise<void>,
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
