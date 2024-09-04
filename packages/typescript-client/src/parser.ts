import { ColumnInfo, Message, Row, Schema, Value } from './types'

type NullToken = null | `NULL`
type Token = Exclude<string, NullToken>
type NullableToken = Token | NullToken
export type ParseFunction = (
  value: Token,
  additionalInfo?: Omit<ColumnInfo, `type` | `dims`>
) => Value
type NullableParseFunction = (
  value: NullableToken,
  additionalInfo?: Omit<ColumnInfo, `type` | `dims`>
) => Value
export type Parser = { [key: string]: ParseFunction }

const parseNumber = (value: string) => Number(value)
const parseBool = (value: string) => value === `true` || value === `t`
const parseBigInt = (value: string) => BigInt(value)
const parseJson = (value: string) => JSON.parse(value)
const identityParser: ParseFunction = (v: string) => v

export const defaultParser: Parser = {
  int2: parseNumber,
  int4: parseNumber,
  int8: parseBigInt,
  bool: parseBool,
  float4: parseNumber,
  float8: parseNumber,
  json: parseJson,
  jsonb: parseJson,
}

// Taken from: https://github.com/electric-sql/pglite/blob/main/packages/pglite/src/types.ts#L233-L279
export function pgArrayParser(value: Token, parser?: ParseFunction): Value {
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

export class MessageParser<T extends Row> {
  private parser: Parser
  constructor(parser?: Parser) {
    // Merge the provided parser with the default parser
    // to use the provided parser whenever defined
    // and otherwise fall back to the default parser
    this.parser = { ...defaultParser, ...parser }
  }

  parse(messages: string, schema: Schema): Message<T>[] {
    return JSON.parse(messages, (key, value) => {
      // typeof value === `object` is needed because
      // there could be a column named `value`
      // and the value associated to that column will be a string
      if (key === `value` && typeof value === `object`) {
        // Parse the row values
        const row = value as Record<string, Value>
        Object.keys(row).forEach((key) => {
          row[key] = this.parseRow(key, row[key] as NullableToken, schema)
        })
      }
      return value
    }) as Message<T>[]
  }

  // Parses the message values using the provided parser based on the schema information
  private parseRow(key: string, value: NullableToken, schema: Schema): Value {
    const columnInfo = schema[key]
    if (!columnInfo) {
      // We don't have information about the value
      // so we just return it
      return value
    }

    // Copy the object but don't include `dimensions` and `type`
    const { type: typ, dims: dimensions, ...additionalInfo } = columnInfo

    // Pick the right parser for the type
    // and support parsing null values if needed
    // if no parser is provided for the given type, just return the value as is
    const typeParser = this.parser[typ] ?? identityParser
    const parser = makeNullableParser(typeParser, columnInfo, key)

    if (dimensions && dimensions > 0) {
      // It's an array
      const nullablePgArrayParser = makeNullableParser(
        (value, _) => pgArrayParser(value, parser),
        columnInfo,
        key
      )
      return nullablePgArrayParser(value)
    }

    return parser(value, additionalInfo)
  }
}

function makeNullableParser(
  parser: ParseFunction,
  columnInfo: ColumnInfo,
  columnName?: string
): NullableParseFunction {
  const isNullable = !(columnInfo.not_null ?? false)
  // The sync service contains `null` value for a column whose value is NULL
  // but if the column value is an array that contains a NULL value
  // then it will be included in the array string as `NULL`, e.g.: `"{1,NULL,3}"`
  return (value: NullableToken) => {
    if (isPgNull(value)) {
      if (!isNullable) {
        throw new Error(`Column ${columnName ?? `unknown`} is not nullable`)
      }
      return null
    }
    return parser(value, columnInfo)
  }
}

function isPgNull(value: NullableToken): value is NullToken {
  return value === null || value === `NULL`
}
