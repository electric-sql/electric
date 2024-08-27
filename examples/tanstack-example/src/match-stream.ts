import {
  type ShapeStream,
  type ChangeMessage,
  type Message,
  type Value,
  isChangeMessage,
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
  return new Promise<ChangeMessage<T>>((resolve, reject) => {
    const unsubscribe = stream.subscribe((messages: Message[]) => {
      const message = messages.find(
        (message) =>
          isChangeMessage(message) &&
          operations.includes(message.headers.operation) &&
          matchFn({
            operationType: message.headers.operation,
            message: message as ChangeMessage<T>,
          })
      ) as ChangeMessage<T> | undefined
      if (message) return finish(message)
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
