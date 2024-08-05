import { ShapeStream, ChangeMessage } from "@electric-sql/next"

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
      messages.forEach((message) => {
        if (`key` in message && operations.includes(message.headers.action)) {
          if (
            matchFn({
              operationType: message.headers.action,
              message: message as ChangeMessage<{ [key: string]: T }>,
            })
          ) {
            finish(message as ChangeMessage<{ [key: string]: T }>)
          }
        }
      })
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
