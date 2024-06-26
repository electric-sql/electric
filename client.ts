import { Message } from "./types"

interface ShapeStreamOptions {
  shape: { table: string }
  baseUrl: string
  subscribe?: boolean
  signal?: AbortSignal
  offset?: number
  shapeId?: string
}

class Subscriber {
  private messageQueue: Message[][] = []
  private isProcessing = false
  private callback: (messages: Message[]) => Promise<void>

  constructor(callback: (messages: Message[]) => Promise<void>) {
    this.callback = callback
  }

  enqueueMessage(messages: Message[]) {
    this.messageQueue.push(messages)
    if (!this.isProcessing) {
      this.processQueue()
    }
  }

  private async processQueue() {
    this.isProcessing = true
    while (this.messageQueue.length > 0) {
      const messages = this.messageQueue.shift()!
      await this.callback(messages)
    }
    this.isProcessing = false
  }
}

export class ShapeStream {
  private subscribers: Array<Subscriber> = []
  private instanceId: number
  private closedPromise: Promise<unknown>
  private outsideResolve?: (value?: unknown) => void
  options: ShapeStreamOptions
  shapeId: string

  constructor(options: ShapeStreamOptions) {
    this.validateOptions(options)
    this.instanceId = Math.random()
    this.options = { subscribe: true, ...options }
    console.log(`constructor`, this)
    this.shapeId = this.options.shapeId || ``
    this.startStream()

    this.outsideResolve
    this.closedPromise = new Promise((resolve) => {
      this.outsideResolve = resolve
    })
  }

  private validateOptions(options: ShapeStreamOptions): void {
    if (
      !options.shape ||
      !options.shape.table ||
      typeof options.shape.table !== `string`
    ) {
      throw new Error(
        `Invalid shape option. It must be an object with a "table" property that is a string.`
      )
    }
    if (!options.baseUrl) {
      throw new Error(`Invalid shape option. It must provide the baseUrl`)
    }
    if (options.signal && !(options.signal instanceof AbortSignal)) {
      throw new Error(
        `Invalid signal option. It must be an instance of AbortSignal.`
      )
    }

    if (options.offset > -1 && !options.shapeId) {
      throw new Error(
        `shapeId is required if this isn't an initial fetch (i.e. offset > -1)`
      )
    }
  }

  private async startStream() {
    let lastOffset = this.options.offset || -1
    let upToDate = false
    let pollCount = 0

    // Variables for exponential backoff
    let attempt = 0
    const maxDelay = 10000 // 10 seconds in milliseconds
    const initialDelay = 100 // 100 milliseconds
    let delay = initialDelay

    // fetch loop.
    while (
      !this.options.signal?.aborted &&
      (!upToDate || this.options.subscribe)
    ) {
      const url = new URL(
        `${this.options.baseUrl}/shape/${this.options.shape.table}`
      )
      url.searchParams.set(`offset`, lastOffset.toString())
      if (upToDate) {
        url.searchParams.set(`live`, ``)
      } else {
        url.searchParams.set(`notLive`, ``)
      }

      url.searchParams.set(`shapeId`, this.shapeId)
      console.log(
        `client`,
        { table: this.options.shape.table },
        {
          lastOffset,
          upToDate,
          pollCount,
          url: url.toString(),
        }
      )
      try {
        await fetch(url.toString(), {
          signal: this.options.signal ? this.options.signal : undefined,
        })
          .then(async (response) => {
            if (!response.ok) {
              throw new Error(`HTTP error! Status: ${response.status}`)
            }
            this.shapeId = response.headers.get(`x-electric-shape-id`)
            console.log({ shapeId: this.shapeId })
            attempt = 0
            if (response.status === 204) {
              return []
            }

            return response.json()
          })
          .then((batch: Message[]) => {
            this.publish(batch)

            // Update upToDate & lastOffset
            if (batch.length > 0) {
              const lastMessages = batch.slice(-2)
              lastMessages.forEach((message) => {
                if (message.headers?.[`control`] === `up-to-date`) {
                  upToDate = true
                }
                if (typeof message.offset !== `undefined`) {
                  lastOffset = message.offset
                }
              })
            }

            pollCount += 1
          })
      } catch (e) {
        if (this.options.signal?.aborted) {
          // Break out of while loop when the user aborts the client.
          break
        } else {
          console.log(`fetch failed`, e)

          // Exponentially backoff on errors.
          // Wait for the current delay duration
          await new Promise((resolve) => setTimeout(resolve, delay))

          // Increase the delay for the next attempt
          delay = Math.min(delay * 1.3, maxDelay)

          attempt++
          console.log(`Retry attempt #${attempt} after ${delay}ms`)
        }
      }
    }

    console.log(`client is closed`, this.instanceId)
    this.outsideResolve && this.outsideResolve()
  }

  subscribe(callback: (messages: Message[]) => Promise<void>) {
    const subscriber = new Subscriber(callback)
    this.subscribers.push(subscriber)
  }

  publish(messages: Message[]) {
    for (const subscriber of this.subscribers) {
      subscriber.enqueueMessage(messages)
    }
  }
}
