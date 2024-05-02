import { Satellite } from '../../satellite'
import {
  QualifiedTablename,
  ReplicatedRowTransformer,
  DbRecord as DataRecord,
} from '../../util'
import { Converter } from '../conversions/converter'
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
    transform: ReplicatedRowTransformer<DataRecord>
  ): void
  clearTableTransform(tableName: QualifiedTablename): void

  transformTableRecord<T extends Record<string, unknown>>(
    record: DataRecord,
    transformRow: (row: T) => T,
    fields: Fields,
    schema: z.ZodTypeAny,
    immutableFields: string[]
  ): DataRecord
}

export class ReplicationTransformManager
  implements IReplicationTransformManager
{
  constructor(private satellite: Satellite, private converter: Converter) {}

  setTableTransform(
    tableName: QualifiedTablename,
    transform: ReplicatedRowTransformer<DataRecord>
  ): void {
    this.satellite.setReplicationTransform(tableName, transform)
  }

  clearTableTransform(tableName: QualifiedTablename): void {
    this.satellite.clearReplicationTransform(tableName)
  }

  transformTableRecord<T extends Record<string, unknown>>(
    record: DataRecord,
    transformRow: (row: T) => T,
    fields: Fields,
    schema: z.ZodTypeAny,
    immutableFields: string[]
  ): DataRecord {
    return transformTableRecord(
      record,
      transformRow,
      fields,
      schema,
      this.converter,
      immutableFields
    )
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
  converter: Converter,
  immutableFields: string[]
): DataRecord {
  // parse raw record according to specified fields
  const parsedRow = transformFields(
    record,
    fields,
    converter,
    Transformation.Decode
  ) as T

  // apply specified transformation
  const transformedParsedRow = transformRow(parsedRow as Readonly<T>)

  // validate transformed row and convert back to raw record
  const validatedTransformedParsedRow = validate(transformedParsedRow, schema)
  const transformedRecord = transformFields(
    validatedTransformedParsedRow,
    fields,
    converter,
    Transformation.Encode
  ) as DataRecord

  // check if any of the immutable fields were modified
  const validatedTransformedRecord = validateRecordTransformation(
    record,
    transformedRecord,
    immutableFields
  )

  return validatedTransformedRecord
}
