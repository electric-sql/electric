/**
 * Implementation of a queue.
 */
class Queue<T> {
  constructor(private queue: Array<T> = []) {}

  enqueue(element: T) {
    this.queue.push(element)
  }

  dequeue(): T | undefined {
    return this.queue.shift()
  }

  isEmpty(): boolean {
    return this.queue.length === 0
  }

  nonEmpty(): boolean {
    return !this.isEmpty()
  }

  size(): number {
    return this.queue.length
  }
}

/**
 * Implementation of a priority queue with static priorities.
 * @template T The type of the elements in the queue.
 * @template P The type of the priorities.
 */
export class PriorityQueue<T, P> {
  private qs: Array<Queue<T>>
  private qIndex: Map<P, number> // priority -> index in qs
  private size = 0

  /**
   * @param priorities An array of priorities from highest to lowest priority.
   * @param getPriority Function to compute the priority of an element.
   */
  constructor(priorities: Array<P>) {
    this.qs = priorities.map((_p) => new Queue<T>())
    this.qIndex = new Map(priorities.map((p, i) => [p, i])) // indexes the priorities
  }

  /**
   *
   * @param element The element to enqueue
   * @param priority The priority associated to this element
   */
  enqueue(element: T, priority: P) {
    const q = this.qIndex.get(priority)
    if (typeof q === 'undefined') {
      throw new Error(`Priority ${priority} not found`)
    }
    this.qs[q].enqueue(element)
    this.size++
  }

  dequeue(): T | undefined {
    const q = this.qs.find((q) => q.nonEmpty())
    if (q !== undefined) {
      this.size--
      return q.dequeue()
    } else {
      return undefined
    }
  }

  isEmpty(): boolean {
    return this.size === 0
  }

  nonEmpty(): boolean {
    return !this.isEmpty()
  }

  getSize(): number {
    return this.size
  }
}
