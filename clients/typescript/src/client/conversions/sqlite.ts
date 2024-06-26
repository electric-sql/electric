import { InvalidArgumentError } from '../validation/errors/invalidArgumentError'
import { Converter, mapRow, mapRows } from './converter'
import { deserialiseBoolean, serialiseBoolean } from './datatypes/boolean'
import { deserialiseBlob, serialiseBlob } from './datatypes/blob'
import { deserialiseDate, serialiseDate } from './datatypes/date'
import { deserialiseJSON, serialiseJSON } from './datatypes/json'
import { PgBasicType, PgDateType, PgType, isPgDateType } from './types'
import { TableSchema } from '../model/schema'

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
  } else if (
    pgType === PgBasicType.PG_JSON ||
    pgType === PgBasicType.PG_JSONB
  ) {
    return serialiseJSON(v)
  } else if (pgType === PgBasicType.PG_BYTEA) {
    return serialiseBlob(v)
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
  } else if (pgType === PgBasicType.PG_INT8) {
    // always return BigInts for PG_INT8 values
    // because some drivers (e.g. wa-sqlite) return a regular JS number if the value fits into a JS number
    // but we know that it should be a BigInt based on the column type
    return BigInt(v)
  } else if (
    pgType === PgBasicType.PG_JSON ||
    pgType === PgBasicType.PG_JSONB
  ) {
    // it's serialised JSON
    return deserialiseJSON(v)
  } else if (pgType === PgBasicType.PG_BYTEA) {
    return deserialiseBlob(v)
  } else {
    return v
  }
}

export const sqliteConverter: Converter = {
  encode: toSqlite,
  encodeRow: <T extends Record<string, unknown> = Record<string, unknown>>(
    row: Record<string, unknown>,
    tableSchema: TableSchema
  ) => mapRow<T>(row, tableSchema, toSqlite),
  encodeRows: <T extends Record<string, unknown> = Record<string, unknown>>(
    rows: Array<Record<string, unknown>>,
    tableSchema: TableSchema
  ) => mapRows<T>(rows, tableSchema, toSqlite),
  decode: fromSqlite,
  decodeRow: <T extends Record<string, any> = Record<string, any>>(
    row: Record<string, unknown>,
    tableSchema: TableSchema
  ) => mapRow<T>(row, tableSchema, fromSqlite),
  decodeRows: <T extends Record<string, unknown> = Record<string, unknown>>(
    rows: Array<Record<string, unknown>>,
    tableSchema: TableSchema
  ) => mapRows<T>(rows, tableSchema, fromSqlite),
}
