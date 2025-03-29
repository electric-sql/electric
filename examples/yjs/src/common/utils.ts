import * as decoding from "lib0/decoding"

const hexStringToUint8Array = (hexString: string) => {
  const cleanHexString = hexString.startsWith(`\\x`)
    ? hexString.slice(2)
    : hexString
  return new Uint8Array(
    cleanHexString.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
  )
}

export const parseToUint8Array = {
  bytea: hexStringToUint8Array,
}

export const parseToDecoder = {
  bytea: (hexString: string) => {
    const uint8Array = hexStringToUint8Array(hexString)
    return decoding.createDecoder(uint8Array)
  },
}

// BUG: if we type multiple characters, we enter the handler
// it looks like the pending operations is not being respected

/**
 * Creates an exponential backoff retry handler
 * @param initialDelayMs Initial delay in milliseconds
 * @param maxDelayMs Maximum delay in milliseconds
 * @param maxRetries Optional maximum number of retries before giving up. If not provided, will retry indefinitely.
 * @returns A function that returns true if should retry, false if should give up
 */
export function createExponentialBackoff(
  initialDelayMs = 1000,
  maxDelayMs = 30000,
  maxRetries?: number
): () => Promise<boolean> {
  let retryCount = 0
  let currentDelay = initialDelayMs

  return async (): Promise<boolean> => {
    // Calculate delay with exponential backoff
    const delay = Math.min(currentDelay, maxDelayMs)

    // Wait for the calculated delay
    await new Promise((resolve) => setTimeout(resolve, delay))

    // Increase retry count and delay for next attempt
    retryCount++
    currentDelay = currentDelay * 2

    if (maxRetries !== undefined && retryCount >= maxRetries) {
      console.log(`Maximum retries (${maxRetries}) reached, giving up`)
      return false
    }

    return true
  }
}
