import { Message, MoveTag, Offset, Row } from './types'
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
  readonly #subscribers = new Map<number, ShapeChangedCallback<T>>()
  readonly #insertedKeys = new Set<string>()
  readonly #requestedSubSnapshots = new Set<string>()
  // Tag indexes for OR-combined subqueries support
  // keyTags: tracks which tags are associated with each row (key -> Set of tags)
  readonly #keyTags: Map<string, Set<MoveTag>> = new Map()
  // tagKeys: inverse index for fast move-out lookups (tag -> Set of keys)
  readonly #tagKeys: Map<MoveTag, Set<string>> = new Map()
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
    // Track this snapshot request for future re-execution on shape rotation
    const key = JSON.stringify(params)
    this.#requestedSubSnapshots.add(key)
    // Ensure the stream is up-to-date so schema is available for parsing
    await this.#awaitUpToDate()
    await this.stream.requestSnapshot(params)
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
        const tags = message.headers.tags ?? []
        const removedTags = message.headers.removed_tags ?? []

        if (this.mode === `full`) {
          switch (message.headers.operation) {
            case `insert`:
              // UPSERT semantics: if key exists, merge tags; otherwise insert new row
              if (this.#data.has(message.key)) {
                // Key exists - merge row data and tags
                this.#data.set(message.key, {
                  ...this.#data.get(message.key)!,
                  ...message.value,
                })
                this.#addTags(message.key, tags)
              } else {
                // New key - insert
                this.#data.set(message.key, message.value)
                this.#addTags(message.key, tags)
              }
              break
            case `update`:
              // Remove old tags first, then add new tags
              this.#removeTags(message.key, removedTags)
              this.#addTags(message.key, tags)

              // Check if all tags were removed - if so, delete the row
              const keyTagsAfterUpdate = this.#keyTags.get(message.key)
              if (
                keyTagsAfterUpdate &&
                keyTagsAfterUpdate.size === 0 &&
                tags.length === 0
              ) {
                this.#data.delete(message.key)
                this.#keyTags.delete(message.key)
              } else {
                this.#data.set(message.key, {
                  ...this.#data.get(message.key)!,
                  ...message.value,
                })
              }
              break
            case `delete`:
              this.#data.delete(message.key)
              // Clean up tag indexes for this key
              this.#removeAllTagsForKey(message.key)
              break
          }
        } else {
          // changes_only: only apply updates/deletes for keys for which we observed an insert
          switch (message.headers.operation) {
            case `insert`:
              // UPSERT semantics for changes_only mode
              if (this.#insertedKeys.has(message.key)) {
                // Key exists - merge row data and tags
                this.#data.set(message.key, {
                  ...this.#data.get(message.key)!,
                  ...message.value,
                })
                this.#addTags(message.key, tags)
              } else {
                this.#insertedKeys.add(message.key)
                this.#data.set(message.key, message.value)
                this.#addTags(message.key, tags)
              }
              break
            case `update`:
              if (this.#insertedKeys.has(message.key)) {
                // Remove old tags first, then add new tags
                this.#removeTags(message.key, removedTags)
                this.#addTags(message.key, tags)

                // Check if all tags were removed - if so, delete the row
                const keyTagsAfterUpdate = this.#keyTags.get(message.key)
                if (
                  keyTagsAfterUpdate &&
                  keyTagsAfterUpdate.size === 0 &&
                  tags.length === 0
                ) {
                  this.#data.delete(message.key)
                  this.#insertedKeys.delete(message.key)
                  this.#keyTags.delete(message.key)
                } else {
                  this.#data.set(message.key, {
                    ...this.#data.get(message.key)!,
                    ...message.value,
                  })
                }
              }
              break
            case `delete`:
              if (this.#insertedKeys.has(message.key)) {
                this.#data.delete(message.key)
                this.#insertedKeys.delete(message.key)
                // Clean up tag indexes for this key
                this.#removeAllTagsForKey(message.key)
              }
              break
          }
        }
      }

      // Handle move-out events
      if (isEventMessage(message)) {
        if (message.headers.event === `move-out`) {
          shouldNotify = this.#updateShapeStatus(`syncing`)
          this.#processMoveOut(message.headers.patterns)
        }
      }

      if (isControlMessage(message)) {
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
            this.#keyTags.clear()
            this.#tagKeys.clear()
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

  // Add tags to both keyTags and tagKeys indexes
  #addTags(key: string, tags: MoveTag[]): void {
    if (tags.length === 0) return

    let keyTagSet = this.#keyTags.get(key)
    if (!keyTagSet) {
      keyTagSet = new Set()
      this.#keyTags.set(key, keyTagSet)
    }

    for (const tag of tags) {
      keyTagSet.add(tag)

      let tagKeySet = this.#tagKeys.get(tag)
      if (!tagKeySet) {
        tagKeySet = new Set()
        this.#tagKeys.set(tag, tagKeySet)
      }
      tagKeySet.add(key)
    }
  }

  // Remove specific tags from both keyTags and tagKeys indexes
  #removeTags(key: string, tags: MoveTag[]): void {
    if (tags.length === 0) return

    const keyTagSet = this.#keyTags.get(key)
    if (!keyTagSet) return

    for (const tag of tags) {
      keyTagSet.delete(tag)

      const tagKeySet = this.#tagKeys.get(tag)
      if (tagKeySet) {
        tagKeySet.delete(key)
        if (tagKeySet.size === 0) {
          this.#tagKeys.delete(tag)
        }
      }
    }

    if (keyTagSet.size === 0) {
      this.#keyTags.delete(key)
    }
  }

  // Remove all tags for a key (used when deleting a row)
  #removeAllTagsForKey(key: string): void {
    const keyTagSet = this.#keyTags.get(key)
    if (!keyTagSet) return

    for (const tag of keyTagSet) {
      const tagKeySet = this.#tagKeys.get(tag)
      if (tagKeySet) {
        tagKeySet.delete(key)
        if (tagKeySet.size === 0) {
          this.#tagKeys.delete(tag)
        }
      }
    }

    this.#keyTags.delete(key)
  }

  // Process move-out patterns: remove tags and delete rows that have no remaining tags
  #processMoveOut(patterns: Array<{ pos: number; value: string }>): void {
    const keysToCheck = new Set<string>()

    for (const pattern of patterns) {
      const tag = pattern.value
      const tagKeySet = this.#tagKeys.get(tag)

      if (tagKeySet) {
        // Collect all keys that have this tag
        for (const key of tagKeySet) {
          keysToCheck.add(key)
          // Remove this tag from the key's tag set
          const keyTagSet = this.#keyTags.get(key)
          if (keyTagSet) {
            keyTagSet.delete(tag)
            if (keyTagSet.size === 0) {
              this.#keyTags.delete(key)
            }
          }
        }
        // Remove the tag from tagKeys index
        this.#tagKeys.delete(tag)
      }
    }

    // For each key, check if all tags were removed - only then delete the row
    for (const key of keysToCheck) {
      const keyTagSet = this.#keyTags.get(key)
      if (!keyTagSet || keyTagSet.size === 0) {
        // All tags removed - delete the row
        this.#data.delete(key)
        this.#insertedKeys.delete(key)
        this.#keyTags.delete(key)
      }
    }
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
}
