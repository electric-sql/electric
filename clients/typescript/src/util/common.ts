import BASE64 from 'base-64'
import { v4 } from 'uuid'
import { SatelliteError } from './types'

// default implementation for uuid()
// platforms that don't support 'uuid' shall override definition
const setGlobalUUID = (global: any) => {
  if (!global['uuid']) {
    global['uuid'] = v4
  }
}
setGlobalUUID(
  typeof global == '' + void 0
    ? typeof self == '' + void 0
      ? this || {}
      : self
    : global
)

export const typeDecoder = {
  bytes: (bytes: Uint8Array) => bytes,
  number: bytesToNumber,
  text: bytesToString,
}

export const typeEncoder = {
  bytes: (bytes: Uint8Array) => bytes,
  number: numberToBytes,
  text: (string: string) => new TextEncoder().encode(string),
}

export const base64 = {
  fromBytes: (bytes: Uint8Array) =>
    BASE64.encode(
      String.fromCharCode.apply(null, new Uint8Array(bytes) as any)
    ),
  toBytes: (string: string) =>
    Uint8Array.from(BASE64.decode(string), (c) => c.charCodeAt(0)),
}

export const DEFAULT_LOG_POS = numberToBytes(0)

export function numberToBytes(i: number) {
  return Uint8Array.of(
    (i & 0xff000000) >> 24,
    (i & 0x00ff0000) >> 16,
    (i & 0x0000ff00) >> 8,
    (i & 0x000000ff) >> 0
  )
}

export function bytesToNumber(bytes: Uint8Array) {
  let n = 0
  for (const byte of bytes.values()) {
    n = (n << 8) | byte
  }
  return n
}

export function bytesToString(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes)
}

export function uuid() {
  return (globalThis as any).uuid()
}

export function emptyPromise<T = void>() {
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
