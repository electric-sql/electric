import { Uuid } from './types'

export const randomValue = (): string => {
  return Math.random().toString(16).substring(2)
}

// only warn about unsafe RNG once to avoid flooding logs
let unsafeRandomWarned = false

export const genUUID = (): Uuid => {
  // best case, `crypto.randomUUID` is available
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }

  const bytes = new Uint8Array(16)

  if (globalThis.crypto?.getRandomValues) {
    // `crypto.getRandomValues` is available even in non-secure contexts
    globalThis.crypto.getRandomValues(bytes)
  } else {
    // fallback to Math.random, if the Crypto API is completely missing
    if (!unsafeRandomWarned) {
      console.warn(
        'Crypto API is not available. ' +
          'Falling back to Math.random for UUID generation ' +
          'with weak uniqueness guarantees. ' +
          'Provide polyfill or alternative for crypto.getRandomValues.'
      )
      unsafeRandomWarned = true
    }
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256)
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40 // Set the 4 most significant bits to 0100
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // Set the 2 most significant bits to 10

  const hexValues: string[] = []
  bytes.forEach((byte) => {
    hexValues.push(byte.toString(16).padStart(2, '0'))
  })

  return (hexValues.slice(0, 4).join('') +
    '-' +
    hexValues.slice(4, 6).join('') +
    '-' +
    hexValues.slice(6, 8).join('') +
    '-' +
    hexValues.slice(8, 10).join('') +
    '-' +
    hexValues.slice(10).join('')) as Uuid
}
