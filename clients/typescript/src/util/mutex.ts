import { PriorityQueue } from './priorityQ'

type ReleaseFn = () => void
type NonEmptyArray<T> = [T, ...T[]]

/**
 * A priority-aware mutex.
 * When releasing the mutex and several acquires are pending,
 * the mutex will be acquired by the pending acquire with the highest priority.
 * Due to the priority queue we use, there must be a fixed number of static priorities.
 * @template P The type of the priorities.
 */
export class Mutex<P> {
  private lockedBy: number = -1 // unlocked
  private nextId = 1
  private pendingQ: PriorityQueue<() => any, P>
  private lowestPriority: P

  constructor(priorities: NonEmptyArray<P>) {
    if (priorities.length === 0) {
      priorities = ['default' as never]
    }
    this.pendingQ = new PriorityQueue(priorities)
    this.lowestPriority = priorities[priorities.length - 1]
  }

  /**
   * @param priority Priority with which to acquire the mutex. Defaults to the lowest priority.
   * @returns A function to release the mutex. This function is idempotent.
   */
  async acquire(priority: P = this.lowestPriority): Promise<ReleaseFn> {
    if (this.locked()) {
      const p = new Promise<void>((resolve) => {
        this.pendingQ.enqueue(resolve, priority)
      })
      await p
    }

    const locker = this.nextId++
    this.lockedBy = locker
    return () => this.release(locker)
  }

  /**
   * Runs the callback exclusively, i.e. no other callback can run concurrently.
   * @param callback The function to run exclusively.
   * @param priority A priority for that function. Defaults to the lowest priority.
   * @returns A promise that resolves to the function's return value.
   */
  async runExclusive<T>(
    callback: () => Promise<T> | T,
    priority: P = this.lowestPriority
  ): Promise<T> {
    const release = await this.acquire(priority)
    try {
      return await callback()
    } finally {
      release()
    }
  }

  // A lock can only be released once and only by the one who acquired it
  private release(id: number): void {
    if (this.lockedBy === id) {
      this.lockedBy = -1
      if (this.pendingQ.nonEmpty()) {
        const resolve = this.pendingQ.dequeue()!
        resolve()
      }
    }
  }

  locked(): boolean {
    return this.lockedBy !== -1
  }
}
