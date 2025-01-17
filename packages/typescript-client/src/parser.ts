import { ColumnInfo, GetExtensions, Message, Row, Schema, Value } from './types'
import { ParserNullValueError } from './error'

type NullToken = null | `NULL`
type Token = Exclude<string, NullToken>
type NullableToken = Token | NullToken
export type ParseFunction<Extensions = never> = (
  value: Token,
  additionalInfo?: Omit<ColumnInfo, `type` | `dims`>
) => Value<Extensions>
type NullableParseFunction<Extensions = never> = (
  value: NullableToken,
  additionalInfo?: Omit<ColumnInfo, `type` | `dims`>
) => Value<Extensions>
/**
 * @typeParam Extensions - Additional types that can be parsed by this parser beyond the standard SQL types.
 *                         Defaults to no additional types.
 */
export type Parser<Extensions = never> = {
  [key: string]: ParseFunction<Extensions>
}

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
export function pgArrayParser<Extensions>(
  value: Token,
  parser?: ParseFunction<Extensions>
): Value<Extensions> {
  let i = 0
  let char = null
  let str = ``
  let quoted = false
  let last = 0
  let p: string | undefined = undefined

  function loop(x: string): Array<Value<Extensions>> {
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

export class MessageParser<T extends Row<unknown>> {
  private parser: Parser<GetExtensions<T>>
  private currentSchema?: Schema
  private compiledRowParser?: (row: Record<string, unknown>) => Record<string, Value<GetExtensions<T>>>

  constructor(parser?: Parser<GetExtensions<T>>) {
    this.parser = { ...defaultParser, ...parser }
  }

  private compileParser(schema: Schema) {
    if (schema === this.currentSchema) return
    
    this.currentSchema = schema

    // Generate parser code for each column
    const parserParts: string[] = []
    
    for (const [columnName, columnInfo] of Object.entries(schema)) {
      const { type: typ, dims: dimensions, not_null } = columnInfo
      
      let valueAccess = `row["${columnName}"]`
      let parserCode = ''

      // Handle null check unless marked as not null
      if (!not_null) {
        parserCode = `${valueAccess} === null || ${valueAccess} === "NULL" ? null : `
      }

      // Add type-specific parsing
      if (dimensions && dimensions > 0) {
        // Handle array types - we'll keep using pgArrayParser for now
        // as optimizing array parsing would need more work
        parserCode += `pgArrayParser(${valueAccess}, v => ${this.getTypeParser('v', typ)})`
      } else {
        parserCode += this.getTypeParser(valueAccess, typ)
      }

      parserParts.push(`"${columnName}": ${parserCode}`)
    }

    // Create the specialized parsing function
    const code = `
      return function parseRow(row) {
        return {
          ${parserParts.join(',\n          ')}
        };
      }
    `

    try {
      // Create and store the compiled function
      this.compiledRowParser = new Function('pgArrayParser', code)(pgArrayParser)
    } catch (e) {
      console.error('Failed to compile parser:', e)
      throw e
    }
  }

  private getTypeParser(value: string, type: string): string {
    switch (type) {
      case 'int2':
      case 'int4':
        return `(${value} | 0)` // Fast integer conversion

      case 'int8':
        return `BigInt(${value})`

      case 'float4':
      case 'float8':
        return `Number(${value})`

      case 'bool':
        return `(${value} === "t" || ${value} === "true")`

      case 'json':
      case 'jsonb':
        return `JSON.parse(${value})`

      // For custom parsers, fall back to the provided parser
      default:
        if (this.parser[type]) {
          return `(${value})`
        }
        return value // Identity parser for unknown types
    }
  }

  parse(messages: string, schema: Schema): Message<T>[] {
    // Compile parser if schema changed
    if (schema !== this.currentSchema) {
      this.compileParser(schema)
    }

    const parseRow = this.compiledRowParser!
    return JSON.parse(messages, (key, value) => {
      if (key === 'value' && typeof value === 'object' && value !== null) {
        return parseRow(value)
      }
      return value
    }) as Message<T>[]
  }
}

function makeNullableParser<Extensions>(
  parser: ParseFunction<Extensions>,
  columnInfo: ColumnInfo,
  columnName?: string
): NullableParseFunction<Extensions> {
  const isNullable = !(columnInfo.not_null ?? false)
  // The sync service contains `null` value for a column whose value is NULL
  // but if the column value is an array that contains a NULL value
  // then it will be included in the array string as `NULL`, e.g.: `"{1,NULL,3}"`
  return (value: NullableToken) => {
    if (isPgNull(value)) {
      if (!isNullable) {
        throw new ParserNullValueError(columnName ?? `unknown`)
      }
      return null
    }
    return parser(value, columnInfo)
  }
}

function isPgNull(value: NullableToken): value is NullToken {
  return value === null || value === `NULL`
}
