import { ColumnInfo, Message, Schema, Value } from './types'

export type ParseFunction = (
  value: string,
  additionalInfo?: Omit<ColumnInfo, `type` | `dims`>
) => Value
export type Parser = { [key: string]: ParseFunction }

const parseNumber = (value: string) => Number(value)
const parseBool = (value: string) => value === `true` || value === `t`
const parseBigInt = (value: string) => BigInt(value)
const parseJson = (value: string) => JSON.parse(value)

export const defaultParser: Parser = {
  int2: parseNumber,
  int4: parseNumber,
  int8: parseBigInt,
  bool: parseBool,
  float8: parseNumber,
  json: parseJson,
  jsonb: parseJson,
}

// Taken from: https://github.com/electric-sql/pglite/blob/main/packages/pglite/src/types.ts#L233-L279
export function pgArrayParser(
  value: string,
  parser?: (s: string) => Value
): Value {
  let i = 0
  let char = null
  let str = ``
  let quoted = false
  let last = 0
  let p: string | undefined = undefined

  function loop(x: string): Value[] {
    const xs = []
    for (; i < x.length; i++) {
      char = x[i]
      if (quoted) {
        if (char === `\\`) {
          str += x[++i]
        } else if (char === `"`) {
          xs.push(parser ? parser(str) : str)
          str = ``
          quoted = x[i + 1] === `"`
          last = i + 2
        } else {
          str += char
        }
      } else if (char === `"`) {
        quoted = true
      } else if (char === `{`) {
        last = ++i
        xs.push(loop(x))
      } else if (char === `}`) {
        quoted = false
        last < i &&
          xs.push(parser ? parser(x.slice(last, i)) : x.slice(last, i))
        last = i + 1
        break
      } else if (char === `,` && p !== `}` && p !== `"`) {
        xs.push(parser ? parser(x.slice(last, i)) : x.slice(last, i))
        last = i + 1
      }
      p = char
    }
    last < i &&
      xs.push(parser ? parser(x.slice(last, i + 1)) : x.slice(last, i + 1))
    return xs
  }

  return loop(value)[0]
}

export class MessageParser {
  private parser: Parser
  constructor(parser?: Parser) {
    // Merge the provided parser with the default parser
    // to use the provided parser whenever defined
    // and otherwise fall back to the default parser
    this.parser = { ...defaultParser, ...parser }
  }

  parse(messages: string, schema: Schema): Message[] {
    return JSON.parse(messages, (key, value) => {
      // typeof value === `object` is needed because
      // there could be a column named `value`
      // and the value associated to that column will be a string
      if (key === `value` && typeof value === `object`) {
        // Parse the row values
        const row = value as Record<string, Value>
        Object.keys(row).forEach((key) => {
          row[key] = this.parseRow(key, row[key] as string, schema)
        })
      }
      return value
    }) as Message[]
  }

  // Parses the message values using the provided parser based on the schema information
  private parseRow(key: string, value: string, schema: Schema): Value {
    const columnInfo = schema[key]
    if (!columnInfo) {
      // We don't have information about the value
      // so we just return it
      return value
    }

    // Pick the right parser for the type
    const parser = this.parser[columnInfo.type]

    // Copy the object but don't include `dimensions` and `type`
    const { type: _typ, dims: dimensions, ...additionalInfo } = columnInfo

    if (dimensions > 0) {
      // It's an array
      const identityParser = (v: string) => v
      return pgArrayParser(value, parser ?? identityParser)
    }

    if (!parser) {
      // No parser was provided for this type of values
      return value
    }

    return parser(value, additionalInfo)
  }
}
