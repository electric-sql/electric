import { ShapeStream, ChangeMessage } from "@electric-sql/client"

export async function matchStream({
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
    message: ChangeMessage<any>
  }) => boolean
  timeout?: number
}): Promise<ChangeMessage<any>> {
  return new Promise((resolve, reject) => {
    const unsubscribe = stream.subscribe((messages) => {
      for (const message of messages) {
        if (`key` in message && operations.includes(message.headers.action)) {
          if (matchFn({ operationType: message.headers.action, message })) {
            return finish(message)
          }
        }
      }
    })

    const timeoutId = setTimeout(() => {
      console.error(`matchStream timed out after ${timeout}ms`)
      reject(`matchStream timed out after ${timeout}ms`)
    }, timeout)

    function finish(message: ChangeMessage<any>) {
      clearTimeout(timeoutId)
      unsubscribe()
      return resolve(message)
    }
  })
}
