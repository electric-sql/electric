import { Message, Offset, Row } from './types'
import { isChangeMessage, isControlMessage } from './helpers'
import { FetchError } from './error'
import { ShapeStreamInterface } from './client'

export type ShapeData<T extends Row<unknown> = Row> = Map<string, T>
export type ShapeChangedCallback<T extends Row<unknown> = Row> = (data: {
  value: ShapeData<T>
  rows: T[]
}) => void

type ShapeStatus = `syncing` | `up-to-date`

/**
 * A Shape is an object that subscribes to a shape log,
 * keeps a materialised shape `.rows` in memory and
 * notifies subscribers when the value has changed.
 *
 * It can be used without a framework and as a primitive
 * to simplify developing framework hooks.
 *
 * @constructor
 * @param {ShapeStream<T extends Row>} - the underlying shape stream
 * @example
 * ```
 * const shapeStream = new ShapeStream<{ foo: number }>({
 *   url: `http://localhost:3000/v1/shape`,
 *   params: {
 *     table: `foo`
 *   }
 * })
 * const shape = new Shape(shapeStream)
 * ```
 *
 * `rows` returns a promise that resolves the Shape data once the Shape has been
 * fully loaded (and when resuming from being offline):
 *
 *     const rows = await shape.rows
 *
 * `currentRows` returns the current data synchronously:
 *
 *     const rows = shape.currentRows
 *
 *  Subscribe to updates. Called whenever the shape updates in Postgres.
 *
 *     shape.subscribe(({ rows }) => {
 *       console.log(rows)
 *     })
 */
export class Shape<T extends Row<unknown> = Row> {
  readonly stream: ShapeStreamInterface<T>

  readonly #data: ShapeData<T> = new Map()
  readonly #subscribers = new Map<number, ShapeChangedCallback<T>>()
  #status: ShapeStatus = `syncing`
  #error: FetchError | false = false

  constructor(stream: ShapeStreamInterface<T>) {
    this.stream = stream
    this.stream.subscribe(
      this.#process.bind(this),
      this.#handleError.bind(this)
    )
  }

  get isUpToDate(): boolean {
    return this.#status === `up-to-date`
  }

  get lastOffset(): Offset {
    return this.stream.lastOffset
  }

  get handle(): string | undefined {
    return this.stream.shapeHandle
  }

  get rows(): Promise<T[]> {
    return this.value.then((v) => Array.from(v.values()))
  }

  get currentRows(): T[] {
    return Array.from(this.currentValue.values())
  }

  get value(): Promise<ShapeData<T>> {
    return new Promise((resolve, reject) => {
      if (this.stream.isUpToDate) {
        resolve(this.currentValue)
      } else {
        const unsubscribe = this.subscribe(({ value }) => {
          unsubscribe()
          if (this.#error) reject(this.#error)
          resolve(value)
        })
      }
    })
  }

  get currentValue() {
    return this.#data
  }

  get error() {
    return this.#error
  }

  /** Unix time at which we last synced. Undefined when `isLoading` is true. */
  lastSyncedAt(): number | undefined {
    return this.stream.lastSyncedAt()
  }

  /** Time elapsed since last sync (in ms). Infinity if we did not yet sync. */
  lastSynced() {
    return this.stream.lastSynced()
  }

  /** True during initial fetch. False afterwise.  */
  isLoading() {
    return this.stream.isLoading()
  }

  /** Indicates if we are connected to the Electric sync service. */
  isConnected(): boolean {
    return this.stream.isConnected()
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
    let shouldNotify = false

    messages.forEach((message) => {
      if (isChangeMessage(message)) {
        shouldNotify = this.#updateShapeStatus(`syncing`)
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
            shouldNotify = this.#updateShapeStatus(`up-to-date`)
            break
          case `must-refetch`:
            this.#data.clear()
            this.#error = false
            shouldNotify = this.#updateShapeStatus(`syncing`)
            break
        }
      }
    })

    if (shouldNotify) this.#notify()
  }

  #updateShapeStatus(status: ShapeStatus): boolean {
    const stateChanged = this.#status !== status
    this.#status = status
    return stateChanged && status === `up-to-date`
  }

  #handleError(e: Error): void {
    if (e instanceof FetchError) {
      this.#error = e
      this.#notify()
    }
  }

  #notify(): void {
    this.#subscribers.forEach((callback) => {
      callback({ value: this.currentValue, rows: this.currentRows })
    })
  }
}
