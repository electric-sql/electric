import * as decoding from "lib0/decoding"

/**
 * Convert a hex string from PostgreSQL's bytea format to a Uint8Array
 */
const hexStringToUint8Array = (hexString: string) => {
  const cleanHexString = hexString.startsWith("\\x")
    ? hexString.slice(2)
    : hexString
  return new Uint8Array(
    cleanHexString.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
  )
}

/**
 * Utility to parse hex string bytea data to a decoder for YJS operations
 */
export const parseToDecoder = {
  bytea: (hexString: string) => {
    const uint8Array = hexStringToUint8Array(hexString)
    return decoding.createDecoder(uint8Array)
  },
}
