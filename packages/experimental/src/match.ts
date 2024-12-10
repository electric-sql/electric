import {
  isChangeMessage,
  type ShapeStreamInterface,
  type ChangeMessage,
  type GetExtensions,
  type Operation,
  type Row,
  type Value,
  type Message,
} from '@electric-sql/client'

export function matchStream<T extends Row<unknown>>(
  stream: ShapeStreamInterface<T>,
  operations: Array<Operation>,
  matchFn: (message: ChangeMessage<T>) => boolean,
  timeout = 60000 // ms
): Promise<ChangeMessage<T>> {
  return new Promise<ChangeMessage<T>>((resolve, reject) => {
    const unsubscribe: () => void = stream.subscribe(
      (messages: Array<unknown>) => {
        const message = messages
          .filter((msg): msg is ChangeMessage<T> =>
            isChangeMessage(msg as Message<Row<never>>)
          )
          .find((message) => {
            const operation: Operation = message.headers.operation

            return operations.includes(operation) && matchFn(message)
          })

        if (message) {
          return finish(message)
        }
      }
    )

    const timeoutId: NodeJS.Timeout = setTimeout(() => {
      const msg: string = `matchStream timed out after ${timeout}ms`

      console.error(msg)

      reject(msg)
    }, timeout)

    function finish(message: ChangeMessage<T>): void {
      clearTimeout(timeoutId)

      unsubscribe()

      return resolve(message)
    }
  })
}

export function matchBy<T extends Row<unknown>>(
  column: string,
  value: Value<GetExtensions<T>>
): (message: ChangeMessage<T>) => boolean {
  return (message: ChangeMessage<T>) => message.value[column] === value
}
