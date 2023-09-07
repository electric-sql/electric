//import { SqlValue } from "../../util"

//type SqliteValue = string | number | null 
//type PgValue = string | number | null

/**
 * This module takes care of converting TypeScript values for Postgres-specific types to a SQLite storeable value and back.
 * For example, a `Date` value representing a Postgres timestamp can be converted to a string that can be stored in SQLite.
 * When reading from the SQLite database, the string can be parsed back into a `Date` object.
 */

export enum PgBasicTypes {
  PG_BOOL = "PG_BOOL",
  PG_SMALLINT = "PG_SMALLINT",
  PG_INT = "PG_INT",
  PG_FLOAT = "PG_FLOAT",
  PG_TEXT = "PG_TEXT",
}

/**
 * Union type of all Pg types that are represented by a `Date` in JS/TS.
 */
export enum PgDateTypes {
  PG_TIMESTAMP = "PG_TIMESTAMP",
  PG_TIMESTAMPTZ = "PG_TIMESTAMPTZ",
  PG_DATE = "PG_DATE",
  PG_TIME = "PG_TIME",
  PG_TIMETZ = "PG_TIMETZ",
}

export type PgType = PgBasicTypes | PgDateTypes

// TODO: currently we define `toSql` and `fromSql` to convert TS -> Sqlite and Sqlite -> TS
//       But we will also need PG -> SQLite and SQLite -> PG when receiving, resp., sending
//       values on the protocol (bc PG representation of e.g. timetz and timestamptz != SQLite representation)
//       see alco's useful table on the PG and SQLite values

//export function toSql(v: PgValue): SqliteValue {
export function toSql(v: Date, pgType: PgDateTypes): string
export function toSql(v: any, pgType: any): any {
  if (v instanceof Date) {
    return serialiseDate(v, pgType)
  }
  else {
    return v
  }
}

//export function fromSql(v: SqliteValue): PgValue {
export function fromSql(v: string, pgType: PgDateTypes): Date
export function fromSql(v: any, pgType: any): any {
  if (Object.values(PgDateTypes).includes(pgType)) {
    // it's a serialised date
    return deserialiseDate(v, pgType)
  }
  else {
    return v
  }
}

// Serialises a `Date` object into a SQLite compatible date string
function serialiseDate(v: Date, pgType: PgDateTypes): string {
  switch (pgType) {
    case PgDateTypes.PG_TIMESTAMP:
      // Returns local timestamp
      return ignoreTimeZone(v).toISOString().replace('T', ' ').replace('Z', '')
    
    case PgDateTypes.PG_TIMESTAMPTZ:
      // Returns UTC timestamp
      return v.toISOString().replace('T', ' ')
    
    case PgDateTypes.PG_DATE:
      // Returns the local date
      return extractDateAndTime(ignoreTimeZone(v)).date
    
    case PgDateTypes.PG_TIME:
      // Returns the local time
      return extractDateAndTime(ignoreTimeZone(v)).time
    
    case PgDateTypes.PG_TIMETZ:
      // Returns UTC time
      return extractDateAndTime(v).time
  }
}

// Deserialises a SQLite compatible date string into a `Date` object
function deserialiseDate(v: string, pgType: PgDateTypes): Date {
  const parse = (v: any) => {
    const millis = Date.parse(v)
    if (isNaN(millis))
        throw new Error(`Could not parse date, invalid format: ${v}`)
      else
        return new Date(millis)
  }

  switch (pgType) {
    case PgDateTypes.PG_TIMESTAMP:
    case PgDateTypes.PG_TIMESTAMPTZ:
    case PgDateTypes.PG_DATE:
      return parse(v)
    
    case PgDateTypes.PG_TIME:
      // interpret as local time
      const timestamp = `1970-01-01 ${v}`
      return parse(timestamp)
    
    case PgDateTypes.PG_TIMETZ:
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