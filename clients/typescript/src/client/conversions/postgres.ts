import { InvalidArgumentError } from '../validation/errors/invalidArgumentError'
import { Converter, mapRow, mapRows } from './converter'
import { deserialiseDate, serialiseDate } from './datatypes/date'
import { isJsonNull } from './datatypes/json'
import { PgBasicType, PgDateType, PgType } from './types'
import { TableSchema } from '../model/schema'

/**
 * This module takes care of converting TypeScript values to a Postgres storeable value and back.
 * These conversions are needed when the developer uses the DAL such that we can convert those JS values to Postgres values
 * and such that values that are read from the Postgres DB can be converted into JS values.
 * Currently, no conversions are needed for the data types we support.
 */

export function toPostgres(v: any, pgType: PgType): any {
  if (v === null) {
    // don't transform null values
    return v
  }

  switch (pgType) {
    case PgDateType.PG_TIMESTAMP:
    case PgDateType.PG_TIMESTAMPTZ:
    case PgDateType.PG_DATE:
    case PgDateType.PG_TIME:
    case PgDateType.PG_TIMETZ:
      if (!(v instanceof Date))
        throw new InvalidArgumentError(
          `Unexpected value ${v}. Expected a Date object.`
        )
      return serialiseDate(v, pgType)

    case PgBasicType.PG_JSON:
    case PgBasicType.PG_JSONB:
      // FIXME: the specialised conversion for null below is needed
      //        because of the pg package we use to connect to the PG database
      //        if we support other PG drivers then this may not be needed
      //        Ideally, we would do this conversion in the driver itself
      if (isJsonNull(v)) {
        // Also turn into a DB null
        // because we currently don't support top-level JSON null value
        // when using Postgres
        return null // 'null'
      }
      return JSON.stringify(v)

    case PgBasicType.PG_FLOAT4:
    case PgBasicType.PG_REAL:
      return Math.fround(v)

    default:
      return v
  }
}

export function fromPostgres(v: any, pgType: PgType): any {
  if (v === null) {
    // don't transform null values
    return v
  }

  switch (pgType) {
    case PgBasicType.PG_INT8:
      return BigInt(v) // needed because the node-pg driver returns bigints as strings

    case PgBasicType.PG_FLOAT4:
    case PgBasicType.PG_REAL:
      // fround the number to represent it as a 32-bit float
      return Math.fround(v)

    case PgDateType.PG_TIME:
    case PgDateType.PG_TIMETZ:
      // dates and timestamps are parsed into JS Date objects
      // by the underlying PG driver we use
      // But time and timetz values are returned as strings
      // so we parse them into a JS Date object ourselves
      return deserialiseDate(v, pgType)

    // Note: i left the specialised conversions below in comment
    //       as they will be needed when we add support for top-level JSON null values
    /*
    case PgBasicType.PG_JSON:
    case PgBasicType.PG_JSONB:
      if (v === 'null') {
        // JSON null value
        return { __is_electric_json_null__: true }
      }
      if (typeof v === 'object') {
        return v
      }
      return JSON.parse(v)
    */

    default:
      return v
  }
}

export const postgresConverter: Converter = {
  encode: toPostgres,
  encodeRow: <T extends Record<string, unknown> = Record<string, unknown>>(
    row: Record<string, unknown>,
    tableSchema: TableSchema
  ) => mapRow<T>(row, tableSchema, toPostgres),
  encodeRows: <T extends Record<string, unknown> = Record<string, unknown>>(
    rows: Array<Record<string, unknown>>,
    tableSchema: TableSchema
  ) => mapRows<T>(rows, tableSchema, toPostgres),
  decode: fromPostgres,
  decodeRow: <T extends Record<string, any> = Record<string, any>>(
    row: Record<string, unknown>,
    tableSchema: TableSchema
  ) => mapRow<T>(row, tableSchema, fromPostgres),
  decodeRows: <T extends Record<string, any> = Record<string, any>>(
    rows: Array<Record<string, unknown>>,
    tableSchema: TableSchema
  ) => mapRows<T>(rows, tableSchema, fromPostgres),
}
