import { MaybePromise } from './types'

/**
 * Processes messages asynchronously in order.
 */
export class AsyncProcessingQueue {
  #processingChain: Promise<void> = Promise.resolve()

  public process(callback: () => MaybePromise<void>): MaybePromise<void> {
    this.#processingChain = this.#processingChain.then(callback)
    return this.#processingChain
  }

  public async waitForProcessing(): Promise<void> {
    let currentChain: Promise<void>
    do {
      currentChain = this.#processingChain
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
 * @param {(message: T) => MaybePromise<void>} callback function
 */
export class MessageProcessor<T> {
  readonly #queue = new AsyncProcessingQueue()
  readonly #callback: (messages: T) => MaybePromise<void>

  constructor(callback: (messages: T) => MaybePromise<void>) {
    this.#callback = callback
  }

  public process(messages: T): void {
    this.#queue.process(() => this.#callback(messages))
  }

  public async waitForProcessing(): Promise<void> {
    await this.#queue.waitForProcessing()
  }
}
