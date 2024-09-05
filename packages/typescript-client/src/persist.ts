import { asyncOrCall, asyncOrIterable } from './async-or'
import {
  type ShapeStreamInterface,
  ShapeStream,
  ShapeStreamOptions,
} from './client'
import { type FetchError } from './error'
import { isChangeMessage, isControlMessage } from './helpers'
import { compareOffset } from './offset'
import { AsyncOrProcessingQueue } from './queue'
import {
  ChangeMessage,
  Offset,
  type Row,
  type Message,
  type Value,
  type PromiseOr,
} from './types'

type StreamStorageItem<T extends Row = Row> = {
  key: string
  value: T
  offset: Offset
  shapeId?: string
}

export interface PersistedShapeStreamOptions
  extends Omit<ShapeStreamOptions, `offset` | `shapeId`> {
  // TODO: fix this type
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  storage: ShapeStreamStorage<any>
}

export interface ShapeStreamStorage<
  T extends Record<string, Value> = Record<string, Value>,
> {
  get: (key: string) => PromiseOr<T | void>
  put: (key: string, entry: T) => PromiseOr<void>
  delete: (key: string) => PromiseOr<void>
  getAll: () => PromiseOr<Iterable<T> | AsyncIterable<T>>
  clear: () => PromiseOr<void>
}

export class PersistedShapeStream<T extends Row = Row>
  implements ShapeStreamInterface<T>
{
  readonly #storage: ShapeStreamStorage<StreamStorageItem<T>>
  readonly #hydrationPromise: Promise<ShapeStreamOptions>
  readonly #streamReadyPromise: Promise<ShapeStream<T>>
  readonly #operationQueue = new AsyncOrProcessingQueue()

  #shapeStream: ShapeStream<T> | undefined
  #hasShapeId: boolean = false

  constructor(options: PersistedShapeStreamOptions) {
    const shapeStreamOptions = {
      ...options,
      offset: undefined,
      shapeId: undefined,
    }
    this.#storage = options.storage
    this.#hydrationPromise = this.#hydrate(shapeStreamOptions)
    this.#streamReadyPromise = this.start().then(() => this.#shapeStream!)
  }

  async #hydrate(options: ShapeStreamOptions): Promise<ShapeStreamOptions> {
    let shapeId: string | undefined
    let latestOffset: Offset = `-1`

    // NOTE: this hydration goes through the whole store to retrieve
    // the shapeId and latestOffset - this is an expensive operation
    // for very little data, but the alternative complicates the
    // storage interface required to persist the stream
    for await (const item of await this.#storage.getAll()) {
      shapeId ??= item.shapeId

      if (compareOffset(item.offset, latestOffset) > 0) {
        latestOffset = item.offset
      }
    }

    return {
      ...options,
      shapeId,
      offset: latestOffset,
    }
  }

  async start(): Promise<void> {
    if (!this.#shapeStream) {
      const options = await this.#hydrationPromise
      this.#shapeStream = new ShapeStream(options)
      this.#shapeStream.subscribe(this.#persistStream.bind(this))
    }
  }

  subscribe(
    callback: (messages: Message<T>[]) => PromiseOr<void>,
    onError?: (error: FetchError | Error) => void
  ): () => void {
    const streamHydrationPromise = this.#operationQueue.process(() =>
      this.#hydrateStream(callback)
    )
    const hydratedCallback = async (messages: Message<T>[]) =>
      asyncOrCall(streamHydrationPromise, (_) => callback(messages))

    const unsubPromise = this.#streamReadyPromise.then((stream) =>
      stream.subscribe(hydratedCallback, onError)
    )
    return () => unsubPromise.then((unsub) => unsub())
  }
  unsubscribeAll(): void {
    this.#streamReadyPromise.then((stream) => stream.unsubscribeAll())
  }
  subscribeOnceToUpToDate(
    callback: () => PromiseOr<void>,
    error: (err: FetchError | Error) => void
  ): () => void {
    const unsubPromise = this.#streamReadyPromise.then((stream) =>
      stream.subscribeOnceToUpToDate(callback, error)
    )
    return () => unsubPromise.then((unsub) => unsub())
  }

  unsubscribeAllUpToDateSubscribers(): void {
    this.#streamReadyPromise.then((stream) =>
      stream.unsubscribeAllUpToDateSubscribers()
    )
  }

  get isUpToDate(): boolean {
    return this.#shapeStream?.isUpToDate ?? false
  }

  get shapeId(): string | undefined {
    return this.#shapeStream?.shapeId
  }

  flush(): PromiseOr<void> {
    return this.#operationQueue.waitForProcessing()
  }

  #hydrateStream(
    callback: (messages: Message<T>[]) => PromiseOr<void>,
    onError?: (error: FetchError | Error) => void
  ): PromiseOr<void> {
    return asyncOrCall(
      this.#storage.getAll(),
      (itemIterable) =>
        asyncOrIterable(itemIterable, (item) =>
          callback([shapeStreamStorageItemToMessage(item)])
        ),
      onError !== undefined ? (err) => onError?.(err as Error) : undefined
    )
  }

  #persistStream(messages: Message<T>[]): PromiseOr<void> {
    let chain: PromiseOr<void> = undefined
    for (const message of messages) {
      chain = this.#operationQueue.process(() => this.#processMessage(message))
    }
    return chain
  }

  #processMessage(message: Message<T>): PromiseOr<void> {
    if (isChangeMessage(message)) {
      switch (message.headers.operation) {
        case `insert`:
        case `update`:
          return this.#storage.put(message.key, {
            key: message.key,
            value: message.value,
            offset: message.offset,
            shapeId: this.#maybeShapeId(),
          })
        case `delete`:
          return this.#storage.delete(message.key)
      }
    }
    if (isControlMessage(message)) {
      switch (message.headers.control) {
        case `up-to-date`:
          break
        case `must-refetch`:
          this.#clearShapeId()
          return this.#storage.clear()
      }
    }
  }

  #clearShapeId(): void {
    this.#hasShapeId = false
  }

  #maybeShapeId(): string | undefined {
    if (!this.#hasShapeId && this.#shapeStream?.shapeId !== undefined) {
      this.#hasShapeId = true
      return this.#shapeStream.shapeId
    }
    return
  }
}

function shapeStreamStorageItemToMessage<T extends Row>(
  item: StreamStorageItem<T>
): ChangeMessage<T> {
  return {
    headers: { operation: `insert`, localCache: true },
    key: item.key,
    value: item.value,
    offset: item.offset,
  }
}
