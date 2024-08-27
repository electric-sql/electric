import {
  ShapeStream,
  ChangeMessage,
  isChangeMessage,
  Value,
} from "@electric-sql/client"

export async function matchStream<T extends Value>({
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
    message: ChangeMessage<T>
  }) => boolean
  timeout?: number
}): Promise<ChangeMessage<T>> {
  return new Promise((resolve, reject) => {
    const unsubscribe = stream.subscribe((messages) => {
      for (const message of messages) {
        if (
          isChangeMessage(message) &&
          operations.includes(message.headers.operation)
        ) {
          if (
            matchFn({
              operationType: message.headers.operation,
              message: message as ChangeMessage<T>,
            })
          ) {
            return finish(message as ChangeMessage<T>)
          }
        }
      }
    })

    const timeoutId = setTimeout(() => {
      console.error(`matchStream timed out after ${timeout}ms`)
      reject(`matchStream timed out after ${timeout}ms`)
    }, timeout)

    function finish(message: ChangeMessage<T>) {
      clearTimeout(timeoutId)
      unsubscribe()
      return resolve(message)
    }
  })
}
