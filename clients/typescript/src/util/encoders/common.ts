import BASE64 from 'base-64'
import { TextEncoderLite, TextDecoderLite } from 'text-encoder-lite'

export const base64 = {
  fromBytes: (bytes: Uint8Array) =>
    BASE64.encode(
      String.fromCharCode.apply(null, new Uint8Array(bytes) as any)
    ),
  toBytes: (string: string) =>
    Uint8Array.from(BASE64.decode(string), (c) => c.charCodeAt(0)),
  encode: (string: string) => base64.fromBytes(textEncoder.encode(string)),
  decode: (string: string) => textDecoder.decode(base64.toBytes(string)),
}

export const textEncoder = {
  encode: (string: string): Uint8Array =>
    globalThis.TextEncoder
      ? new TextEncoder().encode(string)
      : new TextEncoderLite().encode(string),
}

export const textDecoder = {
  decode: (bytes: Uint8Array): string =>
    globalThis.TextDecoder
      ? new TextDecoder().decode(bytes)
      : new TextDecoderLite().decode(bytes),
}

export const trueByte = 't'.charCodeAt(0)
export const falseByte = 'f'.charCodeAt(0)

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
  return textDecoder.decode(bytes)
}

/**
 * Converts a PG string of type `timetz` to its equivalent SQLite string.
 * e.g. '18:28:35.42108+00' -> '18:28:35.42108'
 * @param bytes Data for this `timetz` column.
 * @returns The SQLite string.
 */
export function bytesToTimetzString(bytes: Uint8Array) {
  const str = bytesToString(bytes)
  return str.replace('+00', '')
}

/**
 * Converts an arbitrary blob (or bytestring) into a hex encoded string, which
 * is also the `bytea` PG string.
 * @param bytes - the blob to encode
 * @returns the blob as a hex encoded string
 */
export function blobToHexString(bytes: Uint8Array) {
  let hexString = ''
  for (const byte of bytes.values()) {
    hexString += byte.toString(16).padStart(2, '0')
  }
  return hexString
}

/**
 * Converts a hex encoded string into a `Uint8Array` blob.
 * @param bytes - the blob to encode
 * @returns the blob as a hex encoded string
 */
export function hexStringToBlob(hexString: string) {
  const byteArray = new Uint8Array(hexString.length / 2)
  for (let i = 0; i < hexString.length; i += 2) {
    const byte = parseInt(hexString.substring(i, i + 2), 16)
    byteArray[i / 2] = byte
  }
  return byteArray
}

/**
 * Converts a SQLite string representing a `timetz` value to a PG string.
 * e.g. '18:28:35.42108' -> '18:28:35.42108+00'
 * @param str The SQLite string representing a `timetz` value.
 * @returns The PG string.
 */
export function stringToTimetzString(str: string) {
  return `${str}+00`
}
