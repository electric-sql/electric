function createRandomUUID(): `${string}-${string}-${string}-${string}-${string}` {
  const bytes = new Uint8Array(16)
  const cryptoObj = globalThis.crypto
  const getRandomValues = cryptoObj?.getRandomValues?.bind(cryptoObj)

  if (getRandomValues) {
    getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, `0`))
  return `${hex.slice(0, 4).join(``)}-${hex.slice(4, 6).join(``)}-${hex
    .slice(6, 8)
    .join(``)}-${hex.slice(8, 10).join(``)}-${hex.slice(10, 16).join(``)}`
}

/**
 * Mobile WebViews can expose `crypto.getRandomValues` without the newer
 * `crypto.randomUUID` helper. TanStack DB/runtime transaction creation uses
 * `randomUUID`, so install the missing method at the embed boundary.
 */
export function installMobileCryptoPolyfill(): void {
  if (typeof globalThis === `undefined`) return

  if (!globalThis.crypto) {
    Object.defineProperty(globalThis, `crypto`, {
      configurable: true,
      value: {},
    })
  }

  if (!globalThis.crypto.randomUUID) {
    Object.defineProperty(globalThis.crypto, `randomUUID`, {
      configurable: true,
      value: createRandomUUID,
    })
  }
}
