//import { SqlValue } from "../../util"

import { InvalidArgumentError } from "../validation/errors/invalidArgumentError"

//type SqliteValue = string | number | null 
//type PgValue = string | number | null

/**
 * This module takes care of converting TypeScript values for Postgres-specific types to a SQLite storeable value and back.
 * These conversions are needed when the developer uses the DAL such that we can convert those JS values to SQLite values
 * and such that values that are read from the SQLite DB can be converted into JS values.
 * For example, a `Date` value representing a Postgres timestamp can be converted to a string that can be stored in SQLite.
 * When reading from the SQLite database, the string can be parsed back into a `Date` object.
 */

export enum PgBasicType {
  PG_BOOL = "BOOLEAN",
  PG_SMALLINT = "INT2",
  PG_INT = "INT4",
  PG_FLOAT = "FLOAT8",
  PG_TEXT = "TEXT",
}

/**
 * Union type of all Pg types that are represented by a `Date` in JS/TS.
 */
export enum PgDateType {
  PG_TIMESTAMP = "TIMESTAMP",
  PG_TIMESTAMPTZ = "TIMESTAMPTZ",
  PG_DATE = "DATE",
  PG_TIME = "TIME",
  PG_TIMETZ = "TIMETZ",
}

export type PgType = PgBasicType | PgDateType

//export function toSqlite(v: Date, pgType: PgDateType): string
export function toSqlite(v: any, pgType: PgType): any {
  if (isPgDateType(pgType)) {
    if (!(v instanceof Date))
      throw new InvalidArgumentError(`Unexpected value ${v}. Expected a Date object.`)
    
    return serialiseDate(v, pgType as PgDateType)
  }
  else {
    return v
  }
}

//export function fromSqlite(v: string, pgType: PgDateType): Date
export function fromSqlite(v: any, pgType: PgType): any {
  if (isPgDateType(pgType)) {
    // it's a serialised date
    return deserialiseDate(v, pgType as PgDateType)
  }
  else {
    return v
  }
}

// Serialises a `Date` object into a SQLite compatible date string
function serialiseDate(v: Date, pgType: PgDateType): string {
  switch (pgType) {
    case PgDateType.PG_TIMESTAMP:
      // Returns local timestamp
      return ignoreTimeZone(v).toISOString().replace('T', ' ').replace('Z', '')
    
    case PgDateType.PG_TIMESTAMPTZ:
      // Returns UTC timestamp
      return v.toISOString().replace('T', ' ')
    
    case PgDateType.PG_DATE:
      // Returns the local date
      return extractDateAndTime(ignoreTimeZone(v)).date
    
    case PgDateType.PG_TIME:
      // Returns the local time
      return extractDateAndTime(ignoreTimeZone(v)).time
    
    case PgDateType.PG_TIMETZ:
      // Returns UTC time
      return extractDateAndTime(v).time
  }
}

// Deserialises a SQLite compatible date string into a `Date` object
function deserialiseDate(v: string, pgType: PgDateType): Date {
  const parse = (v: any) => {
    const millis = Date.parse(v)
    if (isNaN(millis))
        throw new Error(`Could not parse date, invalid format: ${v}`)
      else
        return new Date(millis)
  }

  switch (pgType) {
    case PgDateType.PG_TIMESTAMP:
    case PgDateType.PG_TIMESTAMPTZ:
    case PgDateType.PG_DATE:
      return parse(v)
    
    case PgDateType.PG_TIME:
      // interpret as local time
      const timestamp = `1970-01-01 ${v}`
      return parse(timestamp)
    
    case PgDateType.PG_TIMETZ:
      // interpret as UTC time
      const ts = `1970-01-01 ${v}+00`
      return parse(ts)
  }
}

/**
 * Corrects the provided `Date` such that
 * the current date is set as UTC date.
 * e.g. if it is 3PM in GMT+2 then it is 1PM UTC.
 *      This function would return a date in which it is 3PM UTC.
 */
function ignoreTimeZone(v: Date): Date {
  // `v.toISOString` returns the UTC time but we want the time in this timezone
  // so we get the timezone offset and subtract it from the current time in order to
  // compensate for the timezone correction done by `toISOString`
  const offsetInMs = 1000 * 60 * v.getTimezoneOffset()
  return new Date(v.getTime() - offsetInMs)
}

type ExtractedDateTime = { date: string, time: string }
function extractDateAndTime(v: Date): ExtractedDateTime {
  const regex = /([0-9-]*)T([0-9:.]*)Z/g
  const [_, date, time] = regex.exec(v.toISOString())! as unknown as [string, string, string]
  return { date, time }
}

function isPgDateType(pgType: PgType): boolean {
  return (Object.values(PgDateType) as Array<string>).includes(pgType)
}