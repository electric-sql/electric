import { PgDateType } from '../types.js'

// Serialises a `Date` object into a SQLite compatible date string
export function serialiseDate(v: Date, pgType: PgDateType): string {
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
export function deserialiseDate(v: string, pgType: PgDateType): Date {
  const parse = (v: any) => {
    const millis = Date.parse(v)
    if (isNaN(millis))
      throw new Error(`Could not parse date, invalid format: ${v}`)
    else return new Date(millis)
  }

  switch (pgType) {
    case PgDateType.PG_TIMESTAMP:
    case PgDateType.PG_TIMESTAMPTZ:
    case PgDateType.PG_DATE:
      return parse(v)

    case PgDateType.PG_TIME:
      // interpret as local time
      return parse(`1970-01-01 ${v}`)

    case PgDateType.PG_TIMETZ:
      // interpret as UTC time
      return parse(`1970-01-01 ${v}+00`)
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

type ExtractedDateTime = { date: string; time: string }
function extractDateAndTime(v: Date): ExtractedDateTime {
  const regex = /([0-9-]*)T([0-9:.]*)Z/g
  const [_, date, time] = regex.exec(v.toISOString())! as unknown as [
    string,
    string,
    string
  ]
  return { date, time }
}
