import type {
  ShapeStream,
  ChangeMessage,
  Message,
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
  return new Promise<ChangeMessage<T>>((resolve, reject) => {
    const unsubscribe = stream.subscribe((messages: Message<T>[]) => {
      const message = messages.find(
        (message) =>
          `key` in message &&
          operations.includes(message.headers.operation) &&
          matchFn({ operationType: message.headers.operation, message })
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
