import { InvalidArgumentError } from '../validation/errors/invalidArgumentError'
import { Converter } from './converter'
import { deserialiseDate, serialiseDate } from './datatypes/date'
import { isJsonNull } from './datatypes/json'
import { PgBasicType, PgDateType, PgType, isPgDateType } from './types'

/**
 * This module takes care of converting TypeScript values to a Postgres storeable value and back.
 * These conversions are needed when the developer uses the DAL such that we can convert those JS values to Postgres values
 * and such that values that are read from the Postgres DB can be converted into JS values.
 * Currently, no conversions are needed for the data types we support.
 */

function toPostgres(v: any, pgType: PgType): any {
  if (v === null) {
    // don't transform null values
    return v
  }

  if (isPgDateType(pgType)) {
    if (!(v instanceof Date))
      throw new InvalidArgumentError(
        `Unexpected value ${v}. Expected a Date object.`
      )

    return serialiseDate(v, pgType as PgDateType)
  }

  if (pgType === PgBasicType.PG_JSON || pgType === PgBasicType.PG_JSONB) {
    // FIXME: the specialised conversions below are needed because of the pg package
    //        we use to connect to the PG database
    //        if we support other PG drivers then this may not be needed
    //        Ideally, we would do this conversion in the driver itself
    if (v === null) {
      return null
    }
    if (isJsonNull(v)) {
      // Also turn into a DB null
      // because we currently don't support top-level JSON null value
      // when using Postgres
      return null // 'null'
    }
    return JSON.stringify(v)
  }

  if (pgType === PgBasicType.PG_FLOAT4 || pgType === PgBasicType.PG_REAL) {
    return Math.fround(v)
  }

  return v
}

function fromPostgres(v: any, pgType: PgType): any {
  if (v === null) {
    // don't transform null values
    return v
  }

  // no need to convert dates, times, or timestamps
  // because we modified the parser in the node-pg driver
  // to parse them how we want

  if (pgType === PgBasicType.PG_JSON || pgType === PgBasicType.PG_JSONB) {
    if (v === null) {
      // DB null
      return null
    }
    if (v === 'null') {
      // JSON null value
      return { __is_electric_json_null__: true }
    }
    return JSON.parse(v)
  }

  if (pgType === PgBasicType.PG_INT8) {
    return BigInt(v) // needed because the node-pg driver returns bigints as strings
  }

  if (pgType === PgBasicType.PG_FLOAT4 || pgType === PgBasicType.PG_REAL) {
    // fround the number to represent it as a 32-bit float
    return Math.fround(v)
  }

  if (pgType === PgDateType.PG_TIME || pgType === PgDateType.PG_TIMETZ) {
    // dates and timestamps are parsed into JS Date objects
    // by the underlying PG driver we use
    // But time and timetz values are returned as strings
    // so we parse them into a JS Date object ourselves
    return deserialiseDate(v, pgType as PgDateType)
  }

  return v
}

export const postgresConverter: Converter = {
  encode: toPostgres,
  decode: fromPostgres,
}
