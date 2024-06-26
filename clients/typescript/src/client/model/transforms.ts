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
import { DbSchema, Fields, TableSchemas } from './schema'
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
    schema: z.ZodTypeAny | undefined,
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
    schema: z.ZodTypeAny | undefined,
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
  schema: z.ZodTypeAny | undefined,
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
  // schema is only provided when using the DAL
  // if schema is not provided, we skip validation
  const validatedTransformedParsedRow =
    schema !== undefined
      ? validate(transformedParsedRow, schema)
      : transformedParsedRow
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

export function setReplicationTransform<
  T extends Record<string, unknown> = Record<string, unknown>
>(
  dbDescription: DbSchema<TableSchemas>,
  replicationTransformManager: IReplicationTransformManager,
  qualifiedTableName: QualifiedTablename,
  i: ReplicatedRowTransformer<T>,
  schema?: z.ZodTypeAny
): void {
  const tableName = qualifiedTableName.tablename

  if (!dbDescription.hasTable(tableName)) {
    throw new Error(
      `Cannot set replication transform for table '${tableName}'. Table does not exist in the database schema.`
    )
  }

  const fields = dbDescription.getFields(tableName)

  // forbid transforming relation keys to avoid breaking
  // referential integrity

  // the column could be the FK column when it is an outgoing FK
  // or it could be a PK column when it is an incoming FK
  const fkCols = dbDescription
    .getOutgoingRelations(tableName)
    .map((r) => r.fromField)

  // Incoming relations don't have the `fromField` and `toField` filled in
  // so we need to fetch the `toField` from the opposite relation
  // which is effectively a column in this table to which the FK points
  const pkCols = dbDescription
    .getIncomingRelations(tableName)
    .map((r) => r.getOppositeRelation(dbDescription).toField)

  // Merge all columns that are part of a FK relation.
  // Remove duplicate columns in case a column has both an outgoing FK and an incoming FK.
  const immutableFields = Array.from(new Set(fkCols.concat(pkCols)))

  replicationTransformManager.setTableTransform(qualifiedTableName, {
    transformInbound: (record) =>
      replicationTransformManager.transformTableRecord(
        record,
        i.transformInbound,
        fields,
        schema,
        immutableFields
      ),

    transformOutbound: (record) =>
      replicationTransformManager.transformTableRecord(
        record,
        i.transformOutbound,
        fields,
        schema,
        immutableFields
      ),
  })
}
