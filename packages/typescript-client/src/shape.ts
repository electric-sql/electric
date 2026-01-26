import { Message, Offset, Row } from './types'
import { isChangeMessage, isControlMessage, isEventMessage } from './helpers'
import { FetchError } from './error'
import { LogMode, ShapeStreamInterface } from './client'

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
  readonly #subscribers = new Map<object, ShapeChangedCallback<T>>()
  readonly #insertedKeys = new Set<string>()
  readonly #requestedSubSnapshots = new Set<string>()
  #reexecuteSnapshotsPending = false
  #status: ShapeStatus = `syncing`
  #error: FetchError | false = false
  readonly #rowTags = new Map<string, Set<string>>() // key -> set of tag values (simplified for length-1 tags)
  readonly #tagIndex = new Map<string, Set<string>>() // tag value -> set of keys

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
    // Track this snapshot request for future re-execution on shape rotation
    const key = JSON.stringify(params)
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
        shouldNotify = this.#updateShapeStatus(`syncing`)
        if (this.mode === `full`) {
          switch (message.headers.operation) {
            case `insert`:
              this.#data.set(message.key, message.value)
              // Track tags if present
              if (message.headers.tags) {
                const tags = new Set(message.headers.tags)
                this.#rowTags.set(message.key, tags)
                tags.forEach((tag) => this.#addTagToIndex(tag, message.key))
              }
              break
            case `update`:
              this.#data.set(message.key, {
                ...this.#data.get(message.key)!,
                ...message.value,
              })
              // Update tags if present
              if (message.headers.tags) {
                // Remove old tags from index
                const oldTags = this.#rowTags.get(message.key)
                if (oldTags) {
                  oldTags.forEach((tag) =>
                    this.#removeTagFromIndex(tag, message.key)
                  )
                }
                // Set new tags
                const newTags = new Set(message.headers.tags)
                this.#rowTags.set(message.key, newTags)
                newTags.forEach((tag) => this.#addTagToIndex(tag, message.key))
                // If no tags left, remove the row
                this.#removeRowIfNoTags(message.key)
              }
              break
            case `delete`:
              this.#data.delete(message.key)
              // Clean up tag indices
              this.#removeRowFromTagIndices(message.key)
              break
          }
        } else {
          // changes_only: only apply updates/deletes for keys for which we observed an insert
          switch (message.headers.operation) {
            case `insert`:
              this.#insertedKeys.add(message.key)
              this.#data.set(message.key, message.value)
              // Track tags if present
              if (message.headers.tags) {
                const tags = new Set(message.headers.tags)
                this.#rowTags.set(message.key, tags)
                tags.forEach((tag) => this.#addTagToIndex(tag, message.key))
              }
              break
            case `update`:
              if (this.#insertedKeys.has(message.key)) {
                this.#data.set(message.key, {
                  ...this.#data.get(message.key)!,
                  ...message.value,
                })
                // Update tags if present
                if (message.headers.tags) {
                  // Remove old tags from index
                  const oldTags = this.#rowTags.get(message.key)
                  if (oldTags) {
                    oldTags.forEach((tag) =>
                      this.#removeTagFromIndex(tag, message.key)
                    )
                  }
                  // Set new tags
                  const newTags = new Set(message.headers.tags)
                  this.#rowTags.set(message.key, newTags)
                  newTags.forEach((tag) =>
                    this.#addTagToIndex(tag, message.key)
                  )
                  // If no tags left, remove the row
                  this.#removeRowIfNoTags(message.key)
                }
              }
              break
            case `delete`:
              if (this.#insertedKeys.has(message.key)) {
                this.#data.delete(message.key)
                this.#insertedKeys.delete(message.key)
                // Clean up tag indices
                this.#removeRowFromTagIndices(message.key)
              }
              break
          }
        }
      } else if (isEventMessage(message)) {
        shouldNotify = this.#updateShapeStatus(`syncing`)

        switch (message.headers.event) {
          case `move-out`:
            for (const { pos, value } of message.headers.patterns) {
              if (pos != 0)
                throw new Error(`Only 1-width tags are currently supported`)
              this.#removeAllByTagPattern(pos, value)
            }
            break
        }
      } else if (isControlMessage(message)) {
        switch (message.headers.control) {
          case `up-to-date`:
            shouldNotify = this.#updateShapeStatus(`up-to-date`)
            if (this.#reexecuteSnapshotsPending) {
              this.#reexecuteSnapshotsPending = false
              void this.#reexecuteSnapshots()
            }
            break
          case `must-refetch`:
            this.#data.clear()
            this.#insertedKeys.clear()
            this.#rowTags.clear()
            this.#tagIndex.clear()
            this.#error = false
            shouldNotify = this.#updateShapeStatus(`syncing`)
            // Flag to re-execute sub-snapshots once the new shape is up-to-date
            this.#reexecuteSnapshotsPending = true
            break
        }
      }
    })

    if (shouldNotify) this.#notify()
  }

  async #reexecuteSnapshots(): Promise<void> {
    // Wait until stream is up-to-date again (ensures schema is available)
    await this.#awaitUpToDate()

    // Re-execute all snapshots concurrently
    await Promise.all(
      Array.from(this.#requestedSubSnapshots).map(async (jsonParams) => {
        try {
          const snapshot = JSON.parse(jsonParams)
          await this.stream.requestSnapshot(snapshot)
        } catch (_) {
          // Ignore and continue; errors will be surfaced via stream onError
        }
      })
    )
  }

  async #awaitUpToDate(): Promise<void> {
    if (this.stream.isUpToDate) return
    await new Promise<void>((resolve) => {
      const check = () => {
        if (this.stream.isUpToDate) {
          clearInterval(interval)
          unsub()
          resolve()
        }
      }
      const interval = setInterval(check, 10)
      const unsub = this.stream.subscribe(
        () => check(),
        () => check()
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

  /**
   * Adds a key to the tag index for the given tag.
   */
  #addTagToIndex(tag: string, key: string): void {
    let keys = this.#tagIndex.get(tag)
    if (!keys) {
      keys = new Set()
      this.#tagIndex.set(tag, keys)
    }
    keys.add(key)
  }

  /**
   * Removes a key from the tag index for the given tag.
   * If the tag has no more keys, removes the tag from the index.
   */
  #removeTagFromIndex(tag: string, key: string): void {
    const keys = this.#tagIndex.get(tag)
    if (keys) {
      keys.delete(key)
      if (keys.size === 0) {
        this.#tagIndex.delete(tag)
      }
    }
  }

  /**
   * Removes a row from all tag indices.
   * Should be called when a row is being deleted.
   */
  #removeRowFromTagIndices(key: string): void {
    const tags = this.#rowTags.get(key)
    if (tags) {
      tags.forEach((tag) => this.#removeTagFromIndex(tag, key))
      this.#rowTags.delete(key)
    }
  }

  /**
   * Checks if a row has no tags and removes it if so.
   * Returns true if the row was removed.
   */
  #removeRowIfNoTags(key: string): boolean {
    const tags = this.#rowTags.get(key)
    if (tags && tags.size === 0) {
      this.#data.delete(key)
      this.#rowTags.delete(key)
      this.#insertedKeys.delete(key)
      return true
    }
    return false
  }

  #removeAllByTagPattern(_pos: number, tag: string): void {
    // TODO: This is naive, working only while tags are single-width

    const keys = this.#tagIndex.get(tag)
    if (keys) {
      for (const key of keys) {
        if (this.#rowTags.get(key)?.delete(tag)) {
          if (this.#rowTags.get(key)?.size === 0) {
            this.#data.delete(key)
            this.#rowTags.delete(key)
            this.#insertedKeys.delete(key)
          }
        }
      }
      this.#tagIndex.delete(tag)
    }
  }
}
