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
  bool: bytesToBool,
  number: bytesToNumber,
  text: bytesToString,
}

export const typeEncoder = {
  bool: boolToBytes,
  number: numberToBytes,
  real: realToBytes,
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

const trueByte = 't'.charCodeAt(0)
const falseByte = 'f'.charCodeAt(0)

export function boolToBytes(b: number) {
  if (b !== 0 && b !== 1) {
    throw new Error(`Invalid boolean value: ${b}`)
  }
  return new Uint8Array([b === 1 ? trueByte : falseByte])
}
export function bytesToBool(bs: Uint8Array) {
  if (bs.length === 1 && (bs[0] === trueByte || bs[0] === falseByte)) {
    return bs[0] === trueByte ? 1 : 0
  }

  throw new Error(`Invalid binary-encoded boolean value: ${bs}`)
}

export function numberToBytes(i: number) {
  return Uint8Array.of(
    (i & 0xff000000) >> 24,
    (i & 0x00ff0000) >> 16,
    (i & 0x0000ff00) >> 8,
    (i & 0x000000ff) >> 0
  )
}

export function realToBytes(num: number) {
  let num_str = num.toString()
  if (Math.trunc(num) === num) {
    // num is an integer, we need to explicitly append the ".0" to it.
    num_str += '.0'
  }
  return new TextEncoder().encode(num_str)
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
