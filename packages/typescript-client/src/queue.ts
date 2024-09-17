import { MaybePromise } from './types'

function isThenable(value: MaybePromise<void>): value is Promise<void> {
  return (
    !!value &&
    typeof value === `object` &&
    `then` in value &&
    typeof value.then === `function`
  )
}

/**
 * Processes messages asynchronously in order.
 */
export class AsyncProcessingQueue {
  #processingChain: MaybePromise<void> = undefined

  public process(callback: () => MaybePromise<void>): MaybePromise<void> {
    this.#processingChain = isThenable(this.#processingChain)
      ? this.#processingChain.then(callback)
      : callback()
    return this.#processingChain
  }

  public async waitForProcessing(): Promise<void> {
    let currentChain: MaybePromise<void>
    do {
      currentChain = this.#processingChain
      await currentChain
    } while (this.#processingChain !== currentChain)
  }
}

export interface MessageProcessorInterface<T> {
  process(messages: T): MaybePromise<void>
  waitForProcessing(): Promise<void>
}

/**
 * Receives messages, puts them on a queue and processes
 * them synchronously or asynchronously by passing to a
 * registered callback function.
 *
 * @constructor
 * @param {(message: T) => MaybePromise<void>} callback function
 */
export class MessageProcessor<T> implements MessageProcessorInterface<T> {
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
