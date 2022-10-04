export const toHexString = (byteArray: Uint8Array): string => {
  return byteArray.reduce((acc, byte) => {
    return acc + ('0' + (byte & 0xFF).toString(16)).slice(-2)
  }, '')
}
