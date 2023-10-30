import mapValues from 'lodash.mapvalues'
import partition from 'lodash.partition'
import * as z from 'zod'
import { CreateInput, CreateManyInput } from '../input/createInput'
import { FindInput, FindUniqueInput } from '../input/findInput'
import { UpdateInput, UpdateManyInput } from '../input/updateInput'
import { UpsertInput } from '../input/upsertInput'
import { DeleteInput, DeleteManyInput } from '../input/deleteInput'
import { HKT } from '../util/hkt'
import groupBy from 'lodash.groupby'
import { Migration } from '../../migrators'
import { PgType } from '../conversions/sqlite'

export type Arity = 'one' | 'many'

export type TableName = string
export type FieldName = string
export type RelationName = string

export type Fields = Map<FieldName, PgType>

export type TableSchema<
  T extends Record<string, any>,
  CreateData extends object,
  UpdateData extends object,
  Select,
  Where extends object | undefined,
  WhereUnique extends object,
  Include extends Record<string, any>,
  OrderBy,
  ScalarFieldEnum,
  _GetPayload extends HKT
> = {
  fields: Fields
  relations: Relation[]
  modelSchema: z.ZodType<Partial<T>>
  createSchema: z.ZodType<CreateInput<CreateData, Select, Include>>
  createManySchema: z.ZodType<CreateManyInput<CreateData>>
  findUniqueSchema: z.ZodType<FindUniqueInput<Select, WhereUnique, Include>>
  findSchema: z.ZodType<
    FindInput<Select, Where, Include, OrderBy, ScalarFieldEnum>
  >
  updateSchema: z.ZodType<UpdateInput<UpdateData, Select, WhereUnique, Include>>
  updateManySchema: z.ZodType<UpdateManyInput<UpdateData, Where>>
  upsertSchema: z.ZodType<
    UpsertInput<CreateData, UpdateData, Select, WhereUnique, Include>
  >
  deleteSchema: z.ZodType<DeleteInput<Select, WhereUnique, Include>>
  deleteManySchema: z.ZodType<DeleteManyInput<Where>>
}

export type ExtendedTableSchema<
  T extends Record<string, any>,
  CreateData extends object,
  UpdateData extends object,
  Select,
  Where extends object | undefined,
  WhereUnique extends object,
  Include extends Record<string, any>,
  OrderBy,
  ScalarFieldEnum,
  GetPayload extends HKT
> = TableSchema<
  T,
  CreateData,
  UpdateData,
  Select,
  Where,
  WhereUnique,
  Include,
  OrderBy,
  ScalarFieldEnum,
  GetPayload
> & {
  outgoingRelations: Relation[]
  incomingRelations: Relation[]
}

export type TableSchemas = Record<
  TableName,
  TableSchema<any, any, any, any, any, any, any, any, any, HKT>
>

export type ExtendedTableSchemas = Record<
  TableName,
  ExtendedTableSchema<any, any, any, any, any, any, any, any, any, HKT>
>

export class Relation {
  constructor(
    public relationField: FieldName,
    public fromField: FieldName,
    public toField: FieldName,
    public relatedTable: TableName,
    public relationName: RelationName,
    // 'one' if this object can have only one related object,
    // 'many' if this object potentially has many related objects
    public relatedObjects: Arity
  ) {}

  isIncomingRelation(): boolean {
    return this.fromField === '' && this.toField === ''
  }

  isOutgoingRelation(): boolean {
    return !this.isIncomingRelation()
  }

  getOppositeRelation(dbDescription: DbSchema<any>): Relation {
    return dbDescription.getRelation(this.relatedTable, this.relationName)
  }
}

export class DbSchema<T extends TableSchemas> {
  public readonly extendedTables: ExtendedTableSchemas

  // index mapping fields to an array of relations that map to that field
  private readonly incomingRelationsIndex: Record<
    TableName,
    Record<FieldName, Array<Relation>>
  >

  constructor(public tables: T, public migrations: Migration[]) {
    this.extendedTables = this.extend(tables)
    this.incomingRelationsIndex = this.indexIncomingRelations()
  }

  private extend(tbls: T): ExtendedTableSchemas {
    // map over object fields, then take the relations and then split them into 2 parts based on
    // isIncomingRelation and isOutgoingRelation
    return mapValues(tbls, (descr) => {
      const [incoming, outgoing] = partition(descr.relations, (r) =>
        r.isIncomingRelation()
      )
      return {
        ...descr,
        incomingRelations: incoming,
        outgoingRelations: outgoing,
      }
    })
  }

  private indexIncomingRelations(): Record<
    TableName,
    Record<FieldName, Array<Relation>>
  > {
    const tableNames = Object.keys(this.extendedTables)
    const buildRelationIndex = (tableName: TableName) => {
      // For each incoming relation we store the field that is pointed at by the relation
      // Several relations may point to the same field.
      // Therefore, we first group the incoming relations based on the field that they point to
      // Then we store those relations per field
      const inRelations = this.getIncomingRelations(tableName)
      return groupBy(inRelations, (relation) => {
        // group the relations by their `toField` property
        // but need to fetch that property on the outgoing side of the relation
        return relation.getOppositeRelation(this).toField
      })
    }

    const obj: Record<TableName, Record<FieldName, Array<Relation>>> = {}
    tableNames.forEach((tableName) => {
      obj[tableName] = buildRelationIndex(tableName)
    })

    return obj
  }

  getTableDescription(
    table: TableName
  ): ExtendedTableSchema<any, any, any, any, any, any, any, any, any, HKT> {
    return this.extendedTables[table]
  }

  getFields(table: TableName): Fields {
    return this.extendedTables[table].fields
  }

  getFieldNames(table: TableName): FieldName[] {
    return Array.from(this.getFields(table).keys())
  }

  hasRelationForField(table: TableName, field: FieldName): boolean {
    return this.getRelations(table).some((r) => r.relationField === field)
  }

  getRelationName(table: TableName, field: FieldName): RelationName {
    return this.getRelations(table).find((r) => r.relationField === field)!
      .relationName
  }

  getRelation(table: TableName, relation: RelationName): Relation {
    return this.getRelations(table).find((r) => r.relationName === relation)!
  }

  getRelatedTable(table: TableName, field: FieldName): TableName {
    const relationName = this.getRelationName(table, field)
    const relation = this.getRelation(table, relationName)
    return relation.relatedTable
  }

  // Profile.post <-> Post.profile (from: profileId, to: id)
  getRelations(table: TableName): Relation[] {
    return this.extendedTables[table].relations
  }

  getOutgoingRelations(table: TableName): Relation[] {
    return this.extendedTables[table].outgoingRelations
  }

  getIncomingRelations(table: TableName): Relation[] {
    return this.extendedTables[table].incomingRelations
  }

  getRelationsPointingAtField(table: TableName, field: FieldName): Relation[] {
    const index = this.incomingRelationsIndex[table]
    const relations = index[field]
    if (typeof relations === 'undefined') return []
    else return relations
  }
}
