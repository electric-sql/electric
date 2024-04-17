import { numberToBytes } from './encoders/common'
import { SatelliteError } from './types'

export const DEFAULT_LOG_POS = numberToBytes(0)

export type PromiseWithResolvers<T> = {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: any) => void
}

export function emptyPromise<T = void>(): PromiseWithResolvers<T> {
  let resolve: (value: T | PromiseLike<T>) => void
  let reject: (reason?: any) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  // @ts-ignore TS complains that resolve/reject are used here before assignment, but promise constructor will run synchronously
  return { promise, resolve, reject }
}

export type Waiter = {
  waitOn: () => Promise<void>
  resolve: () => Promise<void>
  reject: (error: SatelliteError) => Promise<void>
  finished: () => boolean
}

export function getWaiter(): Waiter {
  const { promise, resolve, reject } = emptyPromise()
  let waiting = false
  let finished = false

  return {
    waitOn: async () => {
      waiting = true
      await promise
    },

    resolve: async () => {
      finished = true
      resolve()
    },

    reject: async (error) => {
      finished = true
      waiting ? reject(error) : resolve()
    },

    finished: () => {
      return finished
    },
  }
}

/**
 * Checks whether the provided value is an object and not an
 * array of some sort
 * @param value - value to check
 * @returns {boolean} whether the `value` is an actual object
 */
export function isObject(value: any): value is object {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    !ArrayBuffer.isView(value)
  )
}
