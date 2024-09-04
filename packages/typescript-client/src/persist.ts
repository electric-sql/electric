import {
  type FetchError,
  type ShapeStreamInterface,
  type ShapeStream,
} from './client'
import { Message } from './types'

type PromiseOr<T> = T | Promise<T>

export interface ShapeStreamStorage {
  get: (id: string, row: unknown) => PromiseOr<void>
  put: (id: string, row: unknown) => PromiseOr<void>
  delete: (id: string) => PromiseOr<unknown>
}

export class ShapeStreamPersister implements ShapeStreamInterface {
  #shapeStream: ShapeStream
  constructor(shapeStream: ShapeStream) {
    this.#shapeStream = shapeStream
  }

  start(): Promise<void> {
    return this.#shapeStream.start()
  }
  subscribe(
    callback: (messages: Message[]) => void | Promise<void>,
    onError?: (error: FetchError | Error) => void
  ): () => void {
    return this.#shapeStream.subscribe(callback, onError)
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
}
