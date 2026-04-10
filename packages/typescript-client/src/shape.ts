import { Message, Offset, Row } from './types'
import {
  isChangeMessage,
  isControlMessage,
  canonicalBigintSafeStringify,
} from './helpers'
import { FetchError } from './error'
import { LogMode, ShapeStreamInterface } from './client'

export type ShapeData<T extends Row<unknown> = Row> = Map<string, T>
export type ShapeChangedCallback<T extends Row<unknown> = Row> = (data: {
  value: ShapeData<T>
  rows: T[]
}) => void

type ShapeStatus = `syncing` | `up-to-date`

/**
 * Shape subscriber notification semantics (see SPEC.md → "Shape
 * notification semantics" for the canonical contract):
 *
 * - **N1 (no notify before first up-to-date).** Data messages that
 *   arrive while `status === 'syncing'` apply to `#data` but do NOT
 *   call `#notify`. The first notification fires when the shape
 *   transitions from `syncing` to `up-to-date` via an up-to-date
 *   control message. This guarantees that subscribers observing
 *   `rows` always see a consistent snapshot of the shape AND can
 *   read a defined `stream.lastSyncedAt()`.
 *
 * - **N2 (notify on change while up-to-date).** Once
 *   `status === 'up-to-date'`, any data message (insert/update/delete,
 *   subject to `mode === 'changes_only'` filtering) triggers a
 *   notification; the status then transitions back to `syncing` until
 *   the next up-to-date message.
 *
 * - **N3 (notify on must-refetch with prior data).** A `must-refetch`
 *   control message clears `#data` and `#insertedKeys`. If the shape
 *   had any prior data, a notification fires so subscribers observe
 *   the now-empty state.
 */

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
  readonly #subscribers = new Map<object, ShapeChangedCallback<T>>()
  readonly #insertedKeys = new Set<string>()
  readonly #requestedSubSnapshots = new Set<string>()
  #reexecuteSnapshotsPending = false
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

  /** Current log mode of the underlying stream */
  get mode(): LogMode {
    return this.stream.mode
  }

  /**
   * Request a snapshot for subset of data. Only available when mode is changes_only.
   * Returns void; data will be emitted via the stream and processed by this Shape.
   */
  async requestSnapshot(
    params: Parameters<ShapeStreamInterface<T>[`requestSnapshot`]>[0]
  ): Promise<void> {
    // Track this snapshot request for future re-execution on shape rotation.
    // Use canonical stringify so permutation-equivalent params dedup.
    const key = canonicalBigintSafeStringify(params)
    this.#requestedSubSnapshots.add(key)
    // Ensure the stream is up-to-date so schema is available for parsing
    await this.#awaitUpToDate()
    await this.stream.requestSnapshot(params)
  }

  subscribe(callback: ShapeChangedCallback<T>): () => void {
    const subscriptionId = {}

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
        const wasUpToDate = this.#status === `up-to-date`
        this.#updateShapeStatus(`syncing`)
        if (this.mode === `full`) {
          switch (message.headers.operation) {
            case `insert`:
              this.#data.set(message.key, message.value)
              if (wasUpToDate) shouldNotify = true
              break
            case `update`:
              this.#data.set(message.key, {
                ...this.#data.get(message.key)!,
                ...message.value,
              })
              if (wasUpToDate) shouldNotify = true
              break
            case `delete`:
              this.#data.delete(message.key)
              if (wasUpToDate) shouldNotify = true
              break
          }
        } else {
          // changes_only: only apply updates/deletes for keys for which we observed an insert
          switch (message.headers.operation) {
            case `insert`:
              this.#insertedKeys.add(message.key)
              this.#data.set(message.key, message.value)
              if (wasUpToDate) shouldNotify = true
              break
            case `update`:
              if (this.#insertedKeys.has(message.key)) {
                this.#data.set(message.key, {
                  ...this.#data.get(message.key)!,
                  ...message.value,
                })
                if (wasUpToDate) shouldNotify = true
              }
              break
            case `delete`:
              if (this.#insertedKeys.has(message.key)) {
                this.#data.delete(message.key)
                this.#insertedKeys.delete(message.key)
                if (wasUpToDate) shouldNotify = true
              }
              break
          }
        }
      }

      if (isControlMessage(message)) {
        switch (message.headers.control) {
          case `up-to-date`:
            if (this.#updateShapeStatus(`up-to-date`)) shouldNotify = true
            if (this.#reexecuteSnapshotsPending) {
              this.#reexecuteSnapshotsPending = false
              void this.#reexecuteSnapshots()
            }
            break
          case `must-refetch`: {
            const hadData = this.#data.size > 0 || this.#insertedKeys.size > 0
            this.#data.clear()
            this.#insertedKeys.clear()
            this.#error = false
            this.#updateShapeStatus(`syncing`)
            if (hadData) shouldNotify = true
            // Flag to re-execute sub-snapshots once the new shape is up-to-date
            this.#reexecuteSnapshotsPending = true
            break
          }
        }
      }
    })

    if (shouldNotify) this.#notify()
  }

  async #reexecuteSnapshots(): Promise<void> {
    try {
      await this.#awaitUpToDate()
    } catch (e) {
      this.#surfaceReexecuteError(e)
      return
    }

    const results = await Promise.all(
      Array.from(this.#requestedSubSnapshots).map(async (jsonParams) => {
        try {
          const snapshot = JSON.parse(jsonParams)
          await this.stream.requestSnapshot(snapshot)
          return undefined
        } catch (e) {
          return e
        }
      })
    )

    const firstError = results.find((e) => e !== undefined)
    if (firstError !== undefined) this.#surfaceReexecuteError(firstError)
  }

  #surfaceReexecuteError(e: unknown): void {
    if (e instanceof FetchError) {
      this.#error = e
    } else if (e instanceof Error) {
      this.#error = new FetchError(0, e.message, undefined, {}, ``, e.message)
    } else {
      this.#error = new FetchError(0, String(e), undefined, {}, ``, String(e))
    }
    this.#notify()
  }

  async #awaitUpToDate(): Promise<void> {
    if (this.#error) throw this.#error
    if (this.stream.isUpToDate) return
    if (this.stream.error) throw this.stream.error as Error
    await new Promise<void>((resolve, reject) => {
      let settled = false
      let interval: ReturnType<typeof setInterval>
      let unsub: (() => void) | undefined
      const done = (action: () => void) => {
        if (settled) return
        settled = true
        clearInterval(interval)
        unsub?.()
        action()
      }
      const check = () => {
        if (this.stream.isUpToDate) return done(resolve)
        const streamError = this.stream.error as Error | undefined
        if (streamError) return done(() => reject(streamError))
        if (this.#error) {
          const err = this.#error
          return done(() => reject(err))
        }
      }
      interval = setInterval(check, 10)
      unsub = this.stream.subscribe(
        () => check(),
        (err) => done(() => reject(err))
      )
      check()
    })
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
