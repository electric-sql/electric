import { bigIntCompare, bigIntMax, bigIntMin } from './bigint-utils'
import {
  ShapeStream,
  isChangeMessage,
  isControlMessage,
} from '@electric-sql/client'
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
    [K in keyof TShapeRows]:
      | ShapeStreamOptions<TShapeRows[K]>
      | ShapeStream<TShapeRows[K]>
  }
  start?: boolean
  checkForUpdatesAfterMs?: number // milliseconds
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
  [K in keyof TShapeRows & string]: MultiShapeMessage<TShapeRows[K], K>
}[keyof TShapeRows & string]

export interface MultiShapeStreamInterface<
  TShapeRows extends {
    [K: string]: Row<unknown>
  },
> {
  shapes: { [K in keyof TShapeRows]: ShapeStream<TShapeRows[K]> }
  checkForUpdatesAfterMs?: number

  subscribe(
    callback: (
      messages: MultiShapeMessages<TShapeRows>[]
    ) => MaybePromise<void>,
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
 * Electric within the `checkForUpdatesAfterMs` interval.
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
 *
 * multiShapeStream.subscribe((msgs) => {
 *   console.log(msgs)
 * })
 *
 * // or with ShapeStream instances
 * const multiShapeStream = new MultiShapeStream({
 *   shapes: {
 *     shape1: new ShapeStream({ url: 'http://localhost:3000/v1/shape1' }),
 *     shape2: new ShapeStream({ url: 'http://localhost:3000/v1/shape2' }),
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
  checkForUpdatesAfterMs?: number

  #checkForUpdatesTimeout?: ReturnType<typeof setTimeout> | undefined

  // We keep track of the last lsn of data and up-to-date messages for each shape
  // so that we can skip checkForUpdates if the lsn of the up-to-date message is
  // greater than the last lsn of data.
  #lastDataLsns: { [K in keyof TShapeRows]: bigint }
  #lastUpToDateLsns: { [K in keyof TShapeRows]: bigint }

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
      checkForUpdatesAfterMs = 100, // Force a check for updates after 100ms
      shapes,
    } = options
    this.checkForUpdatesAfterMs = checkForUpdatesAfterMs
    this.#shapes = Object.fromEntries(
      Object.entries(shapes).map(([key, shape]) => [
        key,
        shape instanceof ShapeStream
          ? shape
          : new ShapeStream<TShapeRows[typeof key]>({
              ...shape,
              start: false,
            }),
      ])
    ) as { [K in keyof TShapeRows]: ShapeStream<TShapeRows[K]> }
    this.#lastDataLsns = Object.fromEntries(
      Object.entries(shapes).map(([key]) => [key, BigInt(-1)])
    ) as { [K in keyof TShapeRows]: bigint }
    this.#lastUpToDateLsns = Object.fromEntries(
      Object.entries(shapes).map(([key]) => [key, BigInt(-1)])
    ) as { [K in keyof TShapeRows]: bigint }
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
          // Whats the max lsn of the up-to-date messages?
          const upToDateLsns = messages
            .filter(isControlMessage)
            .map(({ headers }) =>
              typeof headers.global_last_seen_lsn === `string`
                ? BigInt(headers.global_last_seen_lsn)
                : BigInt(0)
            )
          if (upToDateLsns.length > 0) {
            const maxUpToDateLsn = bigIntMax(...upToDateLsns)
            const lastMaxUpToDateLsn = this.#lastUpToDateLsns[key]
            if (maxUpToDateLsn > lastMaxUpToDateLsn) {
              this.#lastUpToDateLsns[key] = maxUpToDateLsn
            }
          }

          // Whats the max lsn of the data messages?
          const dataLsns = messages
            .filter(isChangeMessage)
            .map(({ headers }) =>
              typeof headers.lsn === `string` ? BigInt(headers.lsn) : BigInt(0)
            )
          if (dataLsns.length > 0) {
            const maxDataLsn = bigIntMax(...dataLsns)
            const lastMaxDataLsn = this.#lastDataLsns[key]
            if (maxDataLsn > lastMaxDataLsn) {
              this.#lastDataLsns[key] = maxDataLsn
            }
            // There is new data, so we need to schedule a check for updates on
            // other shapes
            this.#scheduleCheckForUpdates()
          }

          // Publish the messages to the multi-shape stream subscribers
          const multiShapeMessages = messages.map(
            (message) =>
              ({
                ...message,
                shape: key,
              }) as MultiShapeMessages<TShapeRows>
          )
          await this._publish(multiShapeMessages)
        },
        (error) => this.#onError(error)
      )
    }
    this.#started = true
  }

  #scheduleCheckForUpdates() {
    this.#checkForUpdatesTimeout ??= setTimeout(() => {
      this.#checkForUpdates()
      this.#checkForUpdatesTimeout = undefined
    }, this.checkForUpdatesAfterMs)
  }

  async #checkForUpdates() {
    const maxDataLsn = bigIntMax(...Object.values(this.#lastDataLsns))
    const refreshPromises = this.#shapeEntries()
      .filter(([key]) => {
        // We only need to refresh shapes that have not seen an up-to-date message
        // lower than the max lsn of the data messages we have received.
        const lastUpToDateLsn = this.#lastUpToDateLsns[key]
        return lastUpToDateLsn < maxDataLsn
      })
      .map(([_, shape]) => {
        return shape.forceDisconnectAndRefresh()
      })
    await Promise.all(refreshPromises)
  }

  #onError(error: Error) {
    // TODO: we probably want to disconnect all shapes here on the first error
    this.#subscribers.forEach(([_, errorFn]) => {
      errorFn?.(error)
    })
  }

  protected async _publish(
    messages: MultiShapeMessages<TShapeRows>[]
  ): Promise<void> {
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
    callback: (
      messages: MultiShapeMessages<TShapeRows>[]
    ) => MaybePromise<void>,
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
      ...this.#shapeEntries().map(
        ([_, shape]) => shape.lastSyncedAt() ?? Infinity
      )
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

/**
 * A transactional multi-shape stream is a multi-shape stream that emits the
 * messages in transactional batches, ensuring that all shapes will receive
 * at least an `up-to-date` message from Electric within the `checkForUpdatesAfterMs`
 * interval.
 * It uses the `lsn` metadata to infer transaction boundaries, and the `op_position`
 * metadata to sort the messages within a transaction.
 *
 * @constructor
 * @param {MultiShapeStreamOptions} options - configure the multi-shape stream
 * @example
 * ```ts
 * const transactionalMultiShapeStream = new TransactionalMultiShapeStream({
 *   shapes: {
 *     shape1: {
 *       url: 'http://localhost:3000/v1/shape1',
 *     },
 *     shape2: {
 *       url: 'http://localhost:3000/v1/shape2',
 *     },
 *   },
 * })
 *
 * transactionalMultiShapeStream.subscribe((msgs) => {
 *   console.log(msgs)
 * })
 *
 * // or with ShapeStream instances
 * const transactionalMultiShapeStream = new TransactionalMultiShapeStream({
 *   shapes: {
 *     shape1: new ShapeStream({ url: 'http://localhost:3000/v1/shape1' }),
 *     shape2: new ShapeStream({ url: 'http://localhost:3000/v1/shape2' }),
 *   },
 * })
 * ```
 */

export class TransactionalMultiShapeStream<
  TShapeRows extends {
    [K: string]: Row<unknown>
  },
> extends MultiShapeStream<TShapeRows> {
  #changeMessages = new Map<bigint, MultiShapeMessage<Row<unknown>, string>[]>()
  #completeLsns: {
    [K in keyof TShapeRows]: bigint
  }

  constructor(options: MultiShapeStreamOptions<TShapeRows>) {
    super(options)
    this.#completeLsns = Object.fromEntries(
      Object.entries(options.shapes).map(([key]) => [key, BigInt(-1)])
    ) as { [K in keyof TShapeRows]: bigint }
  }

  #getLowestCompleteLsn() {
    return bigIntMin(...Object.values(this.#completeLsns))
  }

  protected async _publish(
    messages: MultiShapeMessages<TShapeRows>[]
  ): Promise<void> {
    this.#accumulate(messages)
    const lowestCompleteLsn = this.#getLowestCompleteLsn()
    const lsnsToPublish = [...this.#changeMessages.keys()].filter(
      (lsn) => lsn <= lowestCompleteLsn
    )
    const messagesToPublish = lsnsToPublish
      .sort((a, b) => bigIntCompare(a, b))
      .map((lsn) =>
        this.#changeMessages.get(lsn)?.sort((a, b) => {
          const { headers: aHeaders } = a
          const { headers: bHeaders } = b
          if (
            typeof aHeaders.op_position !== `number` ||
            typeof bHeaders.op_position !== `number`
          ) {
            return 0 // op_position is not present on the snapshot message
          }
          return aHeaders.op_position - bHeaders.op_position
        })
      )
      .filter((messages) => messages !== undefined)
      .flat() as MultiShapeMessages<TShapeRows>[]
    lsnsToPublish.forEach((lsn) => {
      this.#changeMessages.delete(lsn)
    })
    if (messagesToPublish.length > 0) {
      await super._publish(messagesToPublish)
    }
  }

  #accumulate(messages: MultiShapeMessages<TShapeRows>[]) {
    const isUpToDate = this.isUpToDate
    messages.forEach((message) => {
      const { shape, headers } = message
      if (isChangeMessage(message)) {
        // The snapshot message does not have an lsn, so we use 0
        const lsn =
          typeof headers.lsn === `string` ? BigInt(headers.lsn) : BigInt(0)
        if (!this.#changeMessages.has(lsn)) {
          this.#changeMessages.set(lsn, [])
        }
        this.#changeMessages.get(lsn)?.push(message)
        if (
          isUpToDate && // All shapes must be up to date
          typeof headers.last === `boolean` &&
          headers.last === true
        ) {
          this.#completeLsns[shape] = bigIntMax(this.#completeLsns[shape], lsn)
        }
      } else if (isControlMessage(message)) {
        if (headers.control === `up-to-date`) {
          if (typeof headers.global_last_seen_lsn !== `string`) {
            throw new Error(`global_last_seen_lsn is not a number`)
          }
          this.#completeLsns[shape] = bigIntMax(
            this.#completeLsns[shape],
            BigInt(headers.global_last_seen_lsn)
          )
        }
      }
    })
  }
}
