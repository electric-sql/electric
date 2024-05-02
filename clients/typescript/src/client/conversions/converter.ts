import { PgType } from './types'

export interface Converter {
  /**
   * Encodes the provided value for storing in the database.
   * @param v The value to encode.
   * @param pgType The Postgres type of the column in which to store the value.
   */
  encode(v: any, pgType: PgType): any
  /**
   * Decodes the provided value from the database.
   * @param v The value to decode.
   * @param pgType The Postgres type of the column from which to decode the value.
   */
  decode(v: any, pgType: PgType): any
}

/**
 * Checks whether the provided value is a data object (e.g. a timestamp) and not a filter.
 * This is important because `input.ts` needs to distinguish between data objects and filter objects.
 * Data objects need to be converted to a SQLite storeable value, whereas filter objects need to be treated specially
 * as we have to transform the values of the filter's fields (cf. `transformFieldsAllowingFilters` in `input.ts`).
 * @param v The value to check
 * @returns True if it is a data object, false otherwise.
 */
export function isDataObject(v: unknown): boolean {
  return v instanceof Date || typeof v === 'bigint' || ArrayBuffer.isView(v)
}
