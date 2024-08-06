import { ShapeStream, ChangeMessage } from "@electric-sql/client"

export async function matchStream<T>({
  stream,
  operations,
  matchFn,
  timeout = 10000,
}: {
  stream: ShapeStream
  operations: Array<`insert` | `update` | `delete`>
  matchFn: ({
    operationType,
    message,
  }: {
    operationType: string
    message: ChangeMessage<{ [key: string]: T }>
  }) => boolean
  timeout?: number
}): Promise<ChangeMessage<{ [key: string]: T }>> {
  return new Promise((resolve, reject) => {
    const unsubscribe = stream.subscribe((messages) => {
      for (const message of messages) {
        if (
          `key` in message &&
          operations.includes(message.headers.operation)
        ) {
          if (
            matchFn({
              operationType: message.headers.operation,
              message: message as ChangeMessage<{ [key: string]: T }>,
            })
          ) {
            return finish(message as ChangeMessage<{ [key: string]: T }>)
          }
        }
      }
    })

    const timeoutId = setTimeout(() => {
      console.error(`matchStream timed out after ${timeout}ms`)
      reject(`matchStream timed out after ${timeout}ms`)
    }, timeout)

    function finish(message: ChangeMessage<{ [key: string]: T }>) {
      clearTimeout(timeoutId)
      unsubscribe()
      return resolve(message)
    }
  })
}
