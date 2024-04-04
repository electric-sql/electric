import * as z from 'zod'
import { InvalidArgumentError } from './errors/invalidArgumentError'
import { Record as RowRecord, isObject } from '../../util'
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

export function parseNestedCreate(relationField: any): { create?: any } {
  const createRelatedObjSchema = z
    .object({
      create: z.any().optional(),
    })
    .strict()

  try {
    return createRelatedObjSchema.parse(relationField)
  } catch (err) {
    if (
      err instanceof z.ZodError &&
      err.issues.some((e) => e.code === 'unrecognized_keys')
    )
      throw new InvalidArgumentError(
        'Unsupported operation. Currently, only nested `create` operation is supported on create query.'
      )
    else throw err
  }
}

export function parseNestedUpdate(relationField: any): {
  update?: any
  updateMany?: any
} {
  const updateRelatedObjSchema = z
    .object({
      update: z.any().optional(),
      updateMany: z.any().optional(),
      //create?: object,
      //upsert?: object,
      //delete?: boolean
    })
    .strict()

  try {
    return updateRelatedObjSchema.parse(relationField)
  } catch (err) {
    if (
      err instanceof z.ZodError &&
      err.issues.some((e) => e.code === 'unrecognized_keys')
    )
      throw new InvalidArgumentError(
        'Unsupported operation. Currently, only nested `update` and `updateMany` operations are supported on an update query.'
      )
    else throw err
  }
}

/**
 * Takes a schema for an object containing an optional `select` property
 * which has an optional `_count` property and removes the `_count` property.
 * @param s Schema for an object containing an optional `select` property.
 */
export function omitCountFromSelectAndIncludeSchema<T extends z.ZodTypeAny>(
  s: T
): T {
  const schema = s as unknown as z.AnyZodObject
  const omitCount = (s: any) => {
    return s
      .unwrap() // `select` and `include` are optional fields, unwrap its schema out of the optional
      .omit({ _count: true }) // remove `_count` field
      .optional() // wrap it back into an optional
  }
  const obj: { select: any; include?: any } = {
    select: omitCount(schema.shape.select),
  }
  if (schema.shape.include) {
    obj['include'] = omitCount(schema.shape.include)
  }
  return schema.merge(z.object(obj)) as unknown as T
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
export function validateRecordTransformation<T extends RowRecord>(
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
