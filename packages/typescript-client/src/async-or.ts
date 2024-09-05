import { PromiseOr } from './types'

export function isPromise<T>(promise: PromiseOr<T>): promise is Promise<T> {
  return (
    !!promise &&
    typeof promise === `object` &&
    `then` in promise &&
    typeof promise.then === `function`
  )
}

export function asyncOrCall<T>(
  item: PromiseOr<T>,
  callback: (item: T) => void,
  onError?: (error: unknown) => void
): PromiseOr<void> {
  if (!isPromise(item)) {
    try {
      return callback(item)
    } catch (err: unknown) {
      if (onError) return onError(err)
      throw err
    }
  }

  return item.then((item) => callback(item)).catch(onError)
}

export function asyncOrIterable<T>(
  iterable: Iterable<T> | AsyncIterable<T>,
  callback: (item: T) => void
): PromiseOr<void> {
  if (Symbol.asyncIterator in iterable) {
    return (async () => {
      for await (const item of iterable) {
        callback(item)
      }
    })()
  }

  for (const item of iterable) {
    callback(item)
  }
}
