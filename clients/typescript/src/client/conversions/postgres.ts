import { InvalidArgumentError } from '../validation/errors/invalidArgumentError'
import { Converter } from './converter'
import { deserialiseDate, serialiseDate } from './datatypes/date'
import { deserialiseJSON, serialiseJSON } from './datatypes/json'
import { PgBasicType, PgDateType, PgType } from './types'

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

  if (pgType === PgDateType.PG_TIME || pgType === PgDateType.PG_TIMETZ) {
    if (!(v instanceof Date))
      throw new InvalidArgumentError(
        `Unexpected value ${v}. Expected a Date object.`
      )

    return serialiseDate(v, pgType as PgDateType)
  }

  if (pgType === PgBasicType.PG_JSON || pgType === PgBasicType.PG_JSONB) {
    return serialiseJSON(v)
  }

  return v
}

function fromPostgres(v: any, pgType: PgType): any {
  if (v === null) {
    // don't transform null values
    return v
  }

  if (pgType === PgDateType.PG_TIME || pgType === PgDateType.PG_TIMETZ) {
    // it's a serialised date
    return deserialiseDate(v, pgType as PgDateType)
  }

  if (pgType === PgBasicType.PG_JSON || pgType === PgBasicType.PG_JSONB) {
    return deserialiseJSON(v)
  }

  if (pgType === PgBasicType.PG_INT8) {
    return BigInt(v) // needed because the node-pg driver returns bigints as strings
  }

  return v
}

export const postgresConverter: Converter = {
  encode: toPostgres,
  decode: fromPostgres,
}
