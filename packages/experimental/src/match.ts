import {
  isChangeMessage,
  type ShapeStreamInterface,
  type ChangeMessage,
  type GetExtensions,
  type Operation,
  type Row,
  type Value,
} from '@electric-sql/client'

export function matchStream<T extends Row<unknown>>(
  stream: ShapeStreamInterface<T>,
  operations: Array<Operation>,
  matchFn: (message: ChangeMessage<T>) => boolean,
  timeout = 60000 // ms
): Promise<ChangeMessage<T>> {
  return new Promise<ChangeMessage<T>>((resolve, reject) => {
    const unsubscribe: () => void = stream.subscribe((messages) => {
      const message = messages.filter(isChangeMessage).find((message) => {
        const operation = message.headers.operation

        return operations.includes(operation) && matchFn(message)
      })

      if (message) {
        return finish(message)
      }
    })

    const timeoutId = setTimeout(() => {
      const msg = `matchStream timed out after ${timeout}ms`

      console.error(msg)

      reject(msg)
    }, timeout)

    function finish(message: ChangeMessage<T>) {
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
  return (message) => message.value[column] === value
}
