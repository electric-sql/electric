import { InvalidArgumentError } from '../validation/errors/invalidArgumentError'
import { deserialiseBoolean, serialiseBoolean } from './datatypes/boolean'
import { deserialiseDate, serialiseDate } from './datatypes/date'
import { PgBasicType, PgDateType, PgType } from './types'

/**
 * This module takes care of converting TypeScript values for Postgres-specific types to a SQLite storeable value and back.
 * These conversions are needed when the developer uses the DAL such that we can convert those JS values to SQLite values
 * and such that values that are read from the SQLite DB can be converted into JS values.
 * For example, a `Date` value representing a Postgres timestamp can be converted to a string that can be stored in SQLite.
 * When reading from the SQLite database, the string can be parsed back into a `Date` object.
 */

export function toSqlite(v: any, pgType: PgType): any {
  if (v === null) {
    // don't transform null values
    return v
  } else if (isPgDateType(pgType)) {
    if (!(v instanceof Date))
      throw new InvalidArgumentError(
        `Unexpected value ${v}. Expected a Date object.`
      )

    return serialiseDate(v, pgType as PgDateType)
  } else if (pgType === PgBasicType.PG_BOOL) {
    return serialiseBoolean(v)
  } else if (Number.isNaN(v)) {
    // Since SQLite does not support `NaN` we serialise `NaN` into the string`'NaN'`
    // and deserialise it back to `NaN` when reading from the DB.
    // cf. https://github.com/WiseLibs/better-sqlite3/issues/1088
    return 'NaN'
  } else if (
    pgType === PgBasicType.PG_FLOAT4 ||
    pgType === PgBasicType.PG_REAL
  ) {
    return Math.fround(v)
  } else {
    return v
  }
}

export function fromSqlite(v: any, pgType: PgType): any {
  if (v === null) {
    // don't transform null values
    return v
  } else if (isPgDateType(pgType)) {
    // it's a serialised date
    return deserialiseDate(v, pgType as PgDateType)
  } else if (pgType === PgBasicType.PG_BOOL) {
    // it's a serialised boolean
    return deserialiseBoolean(v)
  } else if (
    v === 'NaN' &&
    (pgType === PgBasicType.PG_FLOAT8 ||
      pgType === PgBasicType.PG_FLOAT4 ||
      pgType === PgBasicType.PG_REAL)
  ) {
    // it's a serialised NaN
    return NaN
  } else if (
    pgType === PgBasicType.PG_FLOAT4 ||
    pgType === PgBasicType.PG_REAL
  ) {
    // convert to float4 in case someone would have written a bigger value to SQLite directly
    return Math.fround(v)
  } else {
    return v
  }
}

/**
 * Checks whether the provided value is a user-provided data object, e.g. a timestamp.
 * This is important because `input.ts` needs to distinguish between data objects and filter objects.
 * Data objects need to be converted to a SQLite storeable value, whereas filter objects need to be treated specially
 * as we have to transform the values of the filter's fields (cf. `transformFieldsAllowingFilters` in `input.ts`).
 * @param v The value to check
 * @returns True if it is a data object, false otherwise.
 */
export function isDataObject(v: unknown): boolean {
  return v instanceof Date
}

function isPgDateType(pgType: PgType): boolean {
  return (Object.values(PgDateType) as Array<string>).includes(pgType)
}
