import { Message, Row, ShapeStream } from '@electric-sql/client'
import { Client, ClientConfig } from 'pg'

export function makePgClient(overrides: ClientConfig = {}) {
  return new Client({
    host: `localhost`,
    port: 54321,
    password: `password`,
    user: `postgres`,
    database: `electric`,
    options: `-csearch_path=electric_test`,
    ...overrides,
  })
}

// Mock parallel waiter stream implementation
export const createParallelWaiterStream = () => {
  return {
    waitForSyncToComplete: async () => {
      // Mock implementation that resolves immediately
      return Promise.resolve()
    },
  }
}

export function forEachMessage<T extends Row>(
  stream: ShapeStream,
  controller: AbortController,
  handler: (
    resolve: () => void,
    message: Message<T>,
    nthDataMessage: number
  ) => Promise<void> | void
) {
  return new Promise<void>((resolve, reject) => {
    let messageIdx = 0

    stream.subscribe(async (messages) => {
      for (const message of messages) {
        try {
          await handler(
            () => {
              controller.abort()
              return resolve()
            },
            message as Message<T>,
            messageIdx
          )
          if (`operation` in message.headers) messageIdx++
        } catch (e) {
          controller.abort()
          return reject(e)
        }
      }
    }, reject)
  })
}
