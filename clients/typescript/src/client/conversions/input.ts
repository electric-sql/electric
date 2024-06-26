import { Fields } from '../model/schema'
import { Converter, isDataObject } from './converter'
import { isObject } from '../../util'

export enum Transformation {
  Encode, // encode values from JS to SQLite/Postgres
  Decode, // decode values from SQLite/Postgres to JS
}

/**
 * Iterates over the properties of the object `o`
 * in order to transform their values to SQLite/PG compatible values
 * based on additional type information about the fields.
 * @param o The object to transform.
 * @param fields Type information about the fields.
 * @param transformation Which transformation to execute.
 * @returns An object with the values converted to SQLite/PG.
 */
export function transformFields(
  o: object,
  fields: Fields,
  converter: Converter,
  transformation: Transformation = Transformation.Encode
): object {
  // only transform fields that are part of this table and not related fields
  // as those will be transformed later when the query on the related field is processed.
  const copied: Record<string, any> = { ...o }
  Object.entries(o).forEach(([field, value]) => {
    const pgType = fields[field]
    // Skip anything that's not an actual column on the table
    if (pgType === undefined) return

    const transformedValue =
      transformation === Transformation.Encode
        ? converter.encode(value, pgType)
        : converter.decode(value, pgType)

    copied[field] = transformedValue
  })

  return copied
}

export function isFilterObject(value: any): boolean {
  // if it is an object it can only be a data object or a filter object
  return isObject(value) && !isDataObject(value)
}
