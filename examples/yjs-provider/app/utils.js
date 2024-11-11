export const parser = {
    bytea: (hexString) => {
      const cleanHexString = hexString.startsWith("\\x")
        ? hexString.slice(2)
        : hexString
      return new Uint8Array(
        cleanHexString.match(/.{1,2}/g).map((byte) => parseInt(byte, 16))
      )
    },
  }