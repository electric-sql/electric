import { isChangeMessage } from './helpers'

import { type ShapeStreamInterface } from './client'
import { type ChangeMessage, type Operation, type Row } from './types'

export function matchStream<T extends Row>(
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

export function matchBy(column: string, value: any): (message: ChangeMessage) => boolean {
  return (message) => message.value[column] === value
}
