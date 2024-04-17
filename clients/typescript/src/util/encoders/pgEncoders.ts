import { sqliteTypeEncoder, sqliteTypeDecoder } from './sqliteEncoders'
import { textEncoder, textDecoder } from './common'
import { trueByte, falseByte } from './common'

export const pgTypeEncoder = {
  ...sqliteTypeEncoder,
  bool: boolToBytes,
  json: (x: JSON) => {
    const str = JSON.stringify(x)
    console.log('GONNA ENCODE:\n' + x)
    console.log('SERIALISED:\n' + str)
    const res = textEncoder.encode(str)
    console.log('TEXT ENCODED:\n' + res)
    //return textEncoder.encode(serialiseJSON(x))
    return res
  },
}

export const pgTypeDecoder = {
  ...sqliteTypeDecoder,
  bool: bytesToBool,
  json: (bs: Uint8Array) => JSON.parse(textDecoder.decode(bs)),
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
