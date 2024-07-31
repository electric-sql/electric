import { ShapeStream, Value, Message } from '@electric-sql/next'
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

export function forEachMessage<T extends Value>(
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
          if (`action` in message.headers) messageIdx++
        } catch (e) {
          controller.abort()
          return reject(e)
        }
      }
    }, reject)
  })
}
