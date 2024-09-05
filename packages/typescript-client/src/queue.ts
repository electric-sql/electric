import { asyncOrCall, isPromise } from './async-or'
import { PromiseOr } from './types'

/**
 * Receives batches of messages, puts them on a queue and processes
 * them synchronously or asynchronously by passing to a
 * registered callback function.
 *
 * @constructor
 * @param {(messages: T[]) => PromiseOr<void>} callback function
 */
export class MessageProcessor<T> {
  #processingChain: PromiseOr<void> = undefined
  readonly #callback: (messages: T[]) => PromiseOr<void>

  constructor(callback: (messages: T[]) => PromiseOr<void>) {
    this.#callback = callback
  }

  public process(messages: T[]): void {
    this.#processingChain = asyncOrCall(
      this.#processingChain,
      () => this.#callback(messages),
      // TODO: bubble errors up to subscriber or let
      // client handle it in the provided callback?
      // swallow errors
      () => {}
    )
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
