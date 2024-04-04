import { Satellite } from '../../satellite'
import { Record as RowRecord } from '../../util'
import { Transformation, transformFields } from '../conversions/input'
import {
  validate,
  validateRecordTransformation,
} from '../validation/validation'
import { Fields } from './schema'
import * as z from 'zod'

export interface IReplicationTransformManager {
  setTableTransform(
    tableName: string,
    transformInbound: (row: RowRecord) => RowRecord,
    transformOtbound: (row: RowRecord) => RowRecord
  ): void
  clearTableTransform(tableName: string): void
}

export class ReplicationTransformManager
  implements IReplicationTransformManager
{
  constructor(private satellite: Satellite) {}

  setTableTransform(
    tableName: string,
    transformInbound: (row: RowRecord) => RowRecord,
    transformOtbound: (row: RowRecord) => RowRecord
  ): void {
    this.satellite.setReplicationTransform(
      tableName,
      transformInbound,
      transformOtbound
    )
  }

  clearTableTransform(tableName: string): void {
    this.satellite.clearReplicationTransform(tableName)
  }
}

/**
 * Lifts a typed record transformation {@link transformRow} into a transformation of
 * raw records, applying appropriate parsing and validation, including forbidding
 * changes to specified {@link immutableFields}
 *
 * @param transformRow transformation of record of type {@link T}
 * @param fields fields to specify the transformation from raw record to record of type {@link T}
 * @param schema schema to parse/validate raw record to record of type {@link T}
 * @param immutableFields - fields that cannot be modified by {@link transformRow}
 * @return transformation of raw record
 */
export function liftReplicationTransform<T extends Record<string, unknown>>(
  transformRow: (row: T) => T,
  fields: Fields,
  schema: z.ZodTypeAny,
  immutableFields: string[]
): (row: RowRecord) => RowRecord {
  return (row: RowRecord) => {
    // parse raw record according to specified fields
    const parsedRow = transformFields(
      row,
      fields,
      Transformation.Sqlite2Js
    ) as T

    // apply specified transformation
    const transformedParsedRow = transformRow(parsedRow as Readonly<T>)

    // validate transformed row and convert back to raw record
    const validatedTransformedParsedRow = validate(transformedParsedRow, schema)
    const transformedRow = transformFields(
      validatedTransformedParsedRow,
      fields,
      Transformation.Js2Sqlite
    ) as RowRecord

    // check if any of the immutable fields were modified
    const validatedTransformedRow = validateRecordTransformation(
      row,
      transformedRow,
      immutableFields
    )

    return validatedTransformedRow
  }
}
