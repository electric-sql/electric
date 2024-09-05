import { Value } from '../../src'
import { ShapeStreamStorage } from '../../src/persist'
import { InMemoryStorage } from './in-memory'

export class InMemoryAsyncStorage<T extends Record<string, Value>>
  implements ShapeStreamStorage<T>
{
  readonly #store = new InMemoryStorage<T>()
  readonly #maxDelayMs: number
  #operations: Promise<unknown> = Promise.resolve()

  constructor(maxDelayMs: number = 5) {
    this.#maxDelayMs = maxDelayMs
  }

  get(key: string): Promise<T | undefined> {
    return this.#delayRandomly(() => this.#store.get(key))
  }
  put(key: string, value: T): Promise<void> {
    return this.#delayRandomly(() => this.#store.put(key, value))
  }
  delete(key: string): Promise<void> {
    return this.#delayRandomly(() => this.#store.delete(key))
  }

  clear(): Promise<void> {
    return this.#delayRandomly(() => this.#store.clear())
  }

  async *getAll(): AsyncIterable<T> {
    const iterator = this.#store.getAll()
    for (const item of iterator) {
      yield this.#delayRandomly(() => item)
    }
  }

  #delayRandomly<T>(cb: () => T): Promise<T> {
    const op = new Promise<T>((res) => {
      setTimeout(() => res(cb()), Math.random() * this.#maxDelayMs)
    })
    this.#operations = Promise.allSettled([this.#operations, op])
    return op
  }

  async flush(): Promise<void> {
    await this.#operations
  }
}
