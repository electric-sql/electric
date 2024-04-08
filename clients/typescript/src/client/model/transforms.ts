import { Satellite } from '../../satellite'
import {
  QualifiedTablename,
  ReplicationRowTransformer,
  Record as DataRecord,
} from '../../util'
import { Transformation, transformFields } from '../conversions/input'
import {
  validate,
  validateRecordTransformation,
} from '../validation/validation'
import { Fields } from './schema'
import * as z from 'zod'

export interface IReplicationTransformManager {
  setTableTransform(
    tableName: QualifiedTablename,
    transform: ReplicationRowTransformer<DataRecord>
  ): void
  clearTableTransform(tableName: QualifiedTablename): void
}

export class ReplicationTransformManager
  implements IReplicationTransformManager
{
  constructor(private satellite: Satellite) {}

  setTableTransform(
    tableName: QualifiedTablename,
    transform: ReplicationRowTransformer<DataRecord>
  ): void {
    this.satellite.setReplicationTransform(tableName, transform)
  }

  clearTableTransform(tableName: QualifiedTablename): void {
    this.satellite.clearReplicationTransform(tableName)
  }
}

/**
 * Transform a raw record with the given typed row transformation {@link transformRow}
 * by applying appropriate parsing and validation, including forbidding
 * changes to specified {@link immutableFields}
 *
 * @param transformRow transformation of record of type {@link T}
 * @param fields fields to specify the transformation from raw record to record of type {@link T}
 * @param schema schema to parse/validate raw record to record of type {@link T}
 * @param immutableFields - fields that cannot be modified by {@link transformRow}
 * @return the transformed raw record
 */
export function transformTableRecord<T extends Record<string, unknown>>(
  record: DataRecord,
  transformRow: (row: T) => T,
  fields: Fields,
  schema: z.ZodTypeAny,
  immutableFields: string[]
): DataRecord {
  // parse raw record according to specified fields
  const parsedRow = transformFields(
    record,
    fields,
    Transformation.Sqlite2Js
  ) as T

  // apply specified transformation
  const transformedParsedRow = transformRow(parsedRow as Readonly<T>)

  // validate transformed row and convert back to raw record
  const validatedTransformedParsedRow = validate(transformedParsedRow, schema)
  const transformedRecord = transformFields(
    validatedTransformedParsedRow,
    fields,
    Transformation.Js2Sqlite
  ) as DataRecord

  // check if any of the immutable fields were modified
  const validatedTransformedRecord = validateRecordTransformation(
    record,
    transformedRecord,
    immutableFields
  )

  return validatedTransformedRecord
}
