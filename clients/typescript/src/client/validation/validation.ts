import * as z from 'zod'
import { DbRecord as DataRecord, isObject } from '../../util'
import { InvalidRecordTransformationError } from './errors/invalidRecordTransformationError'

function deepOmit(obj: Record<string, any>) {
  Object.keys(obj).forEach((key) => {
    const v = obj[key]
    if (v === undefined) delete obj[key]
    else if (isObject(v)) deepOmit(v)
  })
}

export function validate<I>(i: I, schema: z.ZodTypeAny): I {
  const parsedObject = schema.parse(i)
  // Zod allows users to pass `undefined` as the value for optional fields.
  // However, `undefined` is not a valid SQL value and squel.js will not turn `undefined` into `NULL`.
  // Hence, we have to do an additional pass over the `parsedObject` to remove fields whose value is `undefined`.
  deepOmit(parsedObject)
  return parsedObject
}

/**
 * Validates that the given record transformation did not change any of the specified {@link immutableFields}.
 * @param originalRecord the source record
 * @param trnasformedRecord the transformed record
 * @param immutableFields the fields that should not have been modified
 * @returns the transformed record, validated such that no immutable fields are changed
 *
 * @throws {@link InvalidRecordTransformationError}
 * Thrown if record transformation changed any of the specified {@link immutableFields}
 */
export function validateRecordTransformation<T extends DataRecord>(
  originalRecord: Readonly<T>,
  transformedRecord: Readonly<T>,
  immutableFields: string[]
): T {
  const modifiedImmutableFields = immutableFields.some(
    (key) => originalRecord[key] !== transformedRecord[key]
  )
  if (modifiedImmutableFields) {
    throw new InvalidRecordTransformationError(
      `Record transformation modified immutable fields: ${immutableFields
        .filter((key) => originalRecord[key] !== transformedRecord[key])
        .join(', ')}`
    )
  }

  return transformedRecord
}
