import { asyncOrCall, isPromise } from './async-or'
import { PromiseOr } from './types'

/**
 * Processes messages synchronously or asynchronously in
 * order.
 */
export class AsyncOrProcessingQueue {
  #processingChain: PromiseOr<void> = undefined

  public process(callback: () => PromiseOr<void>): PromiseOr<void> {
    this.#processingChain = asyncOrCall(
      this.#processingChain,
      callback,
      // TODO: bubble errors up to subscriber or let
      // client handle it in the provided callback?
      // swallow errors
      () => {}
    )

    return this.#processingChain
  }

  public async waitForProcessing(): Promise<void> {
    let currentChain: PromiseOr<void>
    do {
      currentChain = this.#processingChain
      if (!isPromise(currentChain)) break
      await currentChain
    } while (this.#processingChain !== currentChain)
  }
}

/**
 * Receives messages, puts them on a queue and processes
 * them synchronously or asynchronously by passing to a
 * registered callback function.
 *
 * @constructor
 * @param {(message: T) => PromiseOr<void>} callback function
 */
export class MessageProcessor<T> {
  readonly #queue: AsyncOrProcessingQueue
  readonly #callback: (messages: T) => PromiseOr<void>

  constructor(callback: (messages: T) => PromiseOr<void>) {
    this.#queue = new AsyncOrProcessingQueue()
    this.#callback = callback
  }

  public process(messages: T): void {
    this.#queue.process(() => this.#callback(messages))
  }

  public async waitForProcessing(): Promise<void> {
    await this.#queue.waitForProcessing()
  }
}
