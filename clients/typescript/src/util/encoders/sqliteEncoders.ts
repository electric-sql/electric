import {
  trueByte,
  falseByte,
  textEncoder,
  stringToTimetzString,
  bytesToString,
  bytesToTimetzString,
} from './common'

export const sqliteTypeEncoder = {
  bool: boolToBytes,
  text: (string: string) => textEncoder.encode(string),
  json: (string: string) => {
    const res = textEncoder.encode(string)
    console.log('TEXTT ENCODED:\n' + res)
    return res
  },
  timetz: (string: string) =>
    sqliteTypeEncoder.text(stringToTimetzString(string)),
}

export const sqliteTypeDecoder = {
  bool: bytesToBool,
  text: bytesToString,
  json: bytesToString,
  timetz: bytesToTimetzString,
  float: bytesToFloat,
}

export function boolToBytes(b: number) {
  if (b !== 0 && b !== 1) {
    throw new Error(`Invalid boolean value: ${b}`)
  }
  return new Uint8Array([b === 1 ? trueByte : falseByte])
}

export function bytesToBool(bs: Uint8Array): number {
  if (bs.length === 1 && (bs[0] === trueByte || bs[0] === falseByte)) {
    return bs[0] === trueByte ? 1 : 0
  }

  throw new Error(`Invalid binary-encoded boolean value: ${bs}`)
}

/**
 * Converts a PG string of type `float4` or `float8` to an equivalent SQLite number.
 * Since SQLite does not recognise `NaN` we turn it into the string `'NaN'` instead.
 * cf. https://github.com/WiseLibs/better-sqlite3/issues/1088
 * @param bytes Data for this `float4` or `float8` column.
 * @returns The SQLite value.
 */
function bytesToFloat(bytes: Uint8Array) {
  const text = sqliteTypeDecoder.text(bytes)
  if (text === 'NaN') {
    return 'NaN'
  } else {
    return Number(text)
  }
}
