import { Message, Row } from './types'
import { isChangeMessage, isControlMessage } from './helpers'
import { FetchError } from './error'
import { ShapeStreamInterface } from './client'

export type ShapeData<T extends Row<unknown> = Row> = Map<string, T>
export type ShapeChangedCallback<T extends Row<unknown> = Row> = (
  value: ShapeData<T>
) => void

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
 * const shapeStream = new ShapeStream<{ foo: number }>(url: `http://localhost:3000/v1/shape`, table: `foo`})
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
export class Shape<T extends Row<unknown> = Row> {
  readonly #stream: ShapeStreamInterface<T>

  readonly #data: ShapeData<T> = new Map()
  readonly #subscribers = new Map<number, ShapeChangedCallback<T>>()

  #hasNotifiedSubscribersUpToDate: boolean = false
  #error: FetchError | false = false

  constructor(stream: ShapeStreamInterface<T>) {
    this.#stream = stream
    this.#stream.subscribe(
      this.#process.bind(this),
      this.#handleError.bind(this)
    )
    const unsubscribe = this.#stream.subscribeOnceToUpToDate(
      () => {
        unsubscribe()
      },
      (e) => {
        this.#handleError(e)
        throw e
      }
    )
  }

  get isUpToDate(): boolean {
    return this.#stream.isUpToDate
  }

  get value(): Promise<ShapeData<T>> {
    return new Promise((resolve, reject) => {
      if (this.#stream.isUpToDate) {
        resolve(this.valueSync)
      } else {
        const unsubscribe = this.subscribe((shapeData) => {
          unsubscribe()
          if (this.#error) reject(this.#error)
          resolve(shapeData)
        })
      }
    })
  }

  get valueSync() {
    return this.#data
  }

  get error() {
    return this.#error
  }

  /** Unix time at which we last synced. Undefined when `isLoading` is true. */
  lastSyncedAt(): number | undefined {
    return this.#stream.lastSyncedAt()
  }

  /** Time elapsed since last sync (in ms). Infinity if we did not yet sync. */
  lastSynced() {
    return this.#stream.lastSynced()
  }

  /** True during initial fetch. False afterwise.  */
  isLoading() {
    return this.#stream.isLoading()
  }

  /** Indicates if we are connected to the Electric sync service. */
  isConnected(): boolean {
    return this.#stream.isConnected()
  }

  subscribe(callback: ShapeChangedCallback<T>): () => void {
    const subscriptionId = Math.random()

    this.#subscribers.set(subscriptionId, callback)

    return () => {
      this.#subscribers.delete(subscriptionId)
    }
  }

  unsubscribeAll(): void {
    this.#subscribers.clear()
  }

  get numSubscribers() {
    return this.#subscribers.size
  }

  #process(messages: Message<T>[]): void {
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
            this.#data.set(message.key, message.value)
            break
          case `update`:
            this.#data.set(message.key, {
              ...this.#data.get(message.key)!,
              ...message.value,
            })
            break
          case `delete`:
            this.#data.delete(message.key)
            break
        }
      }

      if (isControlMessage(message)) {
        switch (message.headers.control) {
          case `up-to-date`:
            isUpToDate = true
            if (!this.#hasNotifiedSubscribersUpToDate) {
              newlyUpToDate = true
            }
            break
          case `must-refetch`:
            this.#data.clear()
            this.#error = false
            this.#hasNotifiedSubscribersUpToDate = false
            isUpToDate = false
            newlyUpToDate = false
            break
        }
      }
    })

    // Always notify subscribers when the Shape first is up to date.
    // FIXME this would be cleaner with a simple state machine.
    if (newlyUpToDate || (isUpToDate && dataMayHaveChanged)) {
      this.#hasNotifiedSubscribersUpToDate = true
      this.#notify()
    }
  }

  #handleError(e: Error): void {
    if (e instanceof FetchError) {
      this.#error = e
      this.#notify()
    }
  }

  #notify(): void {
    this.#subscribers.forEach((callback) => {
      callback(this.valueSync)
    })
  }
}
