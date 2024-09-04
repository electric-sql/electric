import {
  type FetchError,
  type ShapeStreamInterface,
  ShapeStream,
  ShapeStreamOptions,
} from './client'
import { isChangeMessage, isControlMessage } from './helpers'
import { ChangeMessage, Offset, type Row, type Message } from './types'

type PromiseOr<T> = T | Promise<T>
function isPromise<T>(promise: PromiseOr<T>): promise is Promise<T> {
  return (
    !!promise &&
    typeof promise === `object` &&
    `then` in promise &&
    typeof promise.then === `function`
  )
}

type StreamStorageItem<T extends Row = Row> = {
  key: string
  value: T
  offset: Offset
  shapeId?: string

  // NOTE: if we allow comparing offsets on the client we
  // can avoid having this field
  insertedAt: number
}

export type PersistedShapeStreamOptions<T extends Row> = Exclude<
  ShapeStreamOptions,
  `offset` | `shapeId`
> & {
  storage: ShapeStreamStorage<T>
}

export interface ShapeStreamStorage<T extends Row = Row> {
  get: (key: string) => PromiseOr<StreamStorageItem<T>>
  put: (key: string, entry: StreamStorageItem<T>) => PromiseOr<void>
  delete: (key: string) => PromiseOr<void>
  getAll: () => PromiseOr<Iterable<PromiseOr<StreamStorageItem<T>>>>
  clear: () => PromiseOr<void>
}

export class PersistedShapeStream<T extends Row = Row>
  implements ShapeStreamInterface
{
  readonly #storage: ShapeStreamStorage<T>
  readonly #hydrationPromise: Promise<ShapeStreamOptions>

  #shapeStream: ShapeStream<T>
  #operationChain: Promise<unknown> = Promise.resolve()
  #hasShapeId: boolean = false

  constructor(options: PersistedShapeStreamOptions<T>) {
    const shapeStreamOptions = {
      ...options,
      offset: undefined,
      shapeId: undefined,
    }
    this.#shapeStream = new ShapeStream(shapeStreamOptions)
    this.#storage = options.storage
    this.#hydrationPromise = this.#hydrate(shapeStreamOptions)
  }

  async #hydrate(options: ShapeStreamOptions): Promise<ShapeStreamOptions> {
    let shapeId: string | undefined
    let latestOffset: Offset = `-1`
    let latestInsertedAt = -1

    // NOTE: this hydration goes through the whole store to retrieve
    // the shapeId and latestOffset - this is an expensive operation
    // for very little data, but the alternative complicates the
    // storage interface required to persist the stream
    for await (const item of await this.#storage.getAll()) {
      shapeId ??= item.shapeId
      if (item.insertedAt > latestInsertedAt) {
        latestOffset = item.offset
        latestInsertedAt = item.insertedAt
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
    return this.#shapeStream.start()
  }

  subscribe(
    callback: (messages: Message<T>[]) => void | Promise<void>,
    onError?: (error: FetchError | Error) => void
  ): () => void {
    const streamHydrationPromise = this.#chainOperation(
      this.#hydrateStream(callback)
    )
    const hydratedCallback = async (messages: Message<T>[]) =>
      asyncOrCall(streamHydrationPromise, (_) => callback(messages))

    return this.#shapeStream.subscribe(hydratedCallback, onError)
  }
  unsubscribeAll(): void {
    return this.#shapeStream.unsubscribeAll()
  }
  subscribeOnceToUpToDate(
    callback: () => void | Promise<void>,
    error: (err: FetchError | Error) => void
  ): () => void {
    return this.#shapeStream.subscribeOnceToUpToDate(callback, error)
  }
  unsubscribeAllUpToDateSubscribers(): void {
    return this.#shapeStream.unsubscribeAllUpToDateSubscribers()
  }

  get isUpToDate(): boolean {
    return this.#shapeStream.isUpToDate
  }

  get shapeId(): string | undefined {
    return this.#shapeStream.shapeId
  }

  #hydrateStream(
    callback: (messages: Message<T>[]) => void | Promise<void>,
    onError?: (error: FetchError | Error) => void
  ): PromiseOr<void> {
    return asyncOrCall(
      this.#storage.getAll(),
      (itemIterable) => {
        const calls: PromiseOr<void>[] = []
        for (const item of itemIterable) {
          calls.push(
            asyncOrCall(item, (item) =>
              callback([shapeStreamStorageItemToMessage(item)])
            )
          )
        }

        if (calls.length > 0 && isPromise(calls[0])) {
          return Promise.all(calls)
        }
      },
      onError !== undefined ? (err) => onError?.(err as Error) : undefined
    )
  }

  #chainOperation<T>(operation: PromiseOr<T>): PromiseOr<T> {
    // no need to chain synchronous operations
    if (!isPromise(operation)) return operation

    // keep a promise chain to ensure storage operations occur
    // in the right order
    this.#operationChain = this.#operationChain.finally(() => operation)
    return this.#operationChain as Promise<T>
  }

  #persistStream(messages: Message<T>[]): PromiseOr<void> {
    let chain: PromiseOr<void> = undefined
    for (const message of messages) {
      chain = this.#chainOperation(this.#processMessage(message))
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
            insertedAt: Date.now(),
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
    if (!this.#hasShapeId && this.#shapeStream.shapeId !== undefined) {
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
    headers: { operation: `insert` },
    key: item.key,
    value: item.value,
    offset: item.offset,
  }
}

function asyncOrCall<T>(
  item: PromiseOr<T>,
  callback: (item: T) => void,
  onError?: (error: unknown) => void
): PromiseOr<void> {
  if (!isPromise(item)) {
    try {
      return callback(item)
    } catch (err: unknown) {
      if (onError) return onError(err)
      throw err
    }
  }

  return item.then((item) => callback(item)).catch(onError)
}
