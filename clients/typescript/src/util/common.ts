import BASE64 from 'base-64'
import { v4 } from 'uuid'
import { SatelliteError } from './types.js'

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
  text: bytesToString,
  timetz: bytesToTimetzString,
  float: bytesToFloat,
}

export const typeEncoder = {
  bool: boolToBytes,
  text: (string: string) => new TextEncoder().encode(string),
  timetz: (string: string) => typeEncoder.text(stringToTimetzString(string)),
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

/**
 * Converts a PG string of type `timetz` to its equivalent SQLite string.
 * e.g. '18:28:35.42108+00' -> '18:28:35.42108'
 * @param bytes Data for this `timetz` column.
 * @returns The SQLite string.
 */
function bytesToTimetzString(bytes: Uint8Array) {
  const str = bytesToString(bytes)
  return str.replace('+00', '')
}

/**
 * Converts a PG string of type `float4` or `float8` to an equivalent SQLite number.
 * Since SQLite does not recognise `NaN` we turn it into the string `'NaN'` instead.
 * cf. https://github.com/WiseLibs/better-sqlite3/issues/1088
 * @param bytes Data for this `float4` or `float8` column.
 * @returns The SQLite value.
 */
function bytesToFloat(bytes: Uint8Array) {
  const text = typeDecoder.text(bytes)
  if (text === 'NaN') {
    return 'NaN'
  } else {
    return Number(text)
  }
}

/**
 * Converts a SQLite string representing a `timetz` value to a PG string.
 * e.g. '18:28:35.42108' -> '18:28:35.42108+00'
 * @param str The SQLite string representing a `timetz` value.
 * @returns The PG string.
 */
function stringToTimetzString(str: string) {
  return `${str}+00`
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
