import { sqliteTypeEncoder, sqliteTypeDecoder } from './sqliteEncoders'
import { textEncoder } from './common'
import { trueByte, falseByte } from './common'

export const pgTypeEncoder = {
  ...sqliteTypeEncoder,
  bool: boolToBytes,
  json: (x: JSON) => {
    return textEncoder.encode(JSON.stringify(x))
  },
}

export const pgTypeDecoder = {
  ...sqliteTypeDecoder,
  bool: bytesToBool,
}

function boolToBytes(b: boolean) {
  if (typeof b !== 'boolean') {
    throw new Error(`Invalid boolean value: ${b}`)
  }
  return new Uint8Array([b ? trueByte : falseByte])
}

function bytesToBool(bs: Uint8Array): boolean {
  if (bs.length === 1 && (bs[0] === trueByte || bs[0] === falseByte)) {
    return bs[0] === trueByte
  }

  throw new Error(`Invalid binary-encoded boolean value: ${bs}`)
}
