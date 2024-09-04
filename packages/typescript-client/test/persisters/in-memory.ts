import { Value } from '../../src'
import { ShapeStreamStorage } from '../../src/persist'

export class InMemoryStorage<T extends Record<string, Value>>
  implements ShapeStreamStorage<T>
{
  #map = new Map<string, T>()

  get(key: string): T | undefined {
    return this.#map.get(key)
  }
  put(key: string, value: T): void {
    this.#map.set(key, value)
  }
  delete(key: string): void {
    this.#map.delete(key)
  }

  clear(): void {
    this.#map.clear()
  }

  getAll(): Iterable<T> {
    return this.#map.values()
  }
}
