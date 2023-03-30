import mapValues from 'lodash.mapvalues'
import partition from 'lodash.partition'
import * as z from 'zod'
import { CreateInput, CreateManyInput } from '../input/createInput'
import { FindInput, FindUniqueInput } from '../input/findInput'
import { UpdateInput, UpdateManyInput } from '../input/updateInput'
import { UpsertInput } from '../input/upsertInput'
import { DeleteInput, DeleteManyInput } from '../input/deleteInput'
import { URIS } from 'fp-ts/HKT'

export type Arity = 'one' | 'many'

export type TableName = string
export type FieldName = string
export type RelationName = string

export type TableDescription<
  T extends Record<string, any>,
  CreateData extends object,
  UpdateData,
  Select,
  Where,
  WhereUnique,
  Include extends Record<string, any>,
  OrderBy,
  ScalarFieldEnum,
  _GetPayload extends URIS
> = {
  fields: FieldName[]
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

export type ExtendedTableDescription<
  T extends Record<string, any>,
  CreateData extends object,
  UpdateData,
  Select,
  Where,
  WhereUnique,
  Include extends Record<string, any>,
  OrderBy,
  ScalarFieldEnum,
  GetPayload extends URIS
> = TableDescription<
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

export type TableDescriptions = Record<
  TableName,
  TableDescription<any, any, any, any, any, any, any, any, any, URIS>
>

export type ExtendedTableDescriptions = Record<
  TableName,
  ExtendedTableDescription<any, any, any, any, any, any, any, any, any, URIS>
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

  getOppositeRelation(dbDescription: DBDescription<any>): Relation {
    return dbDescription.getRelation(this.relatedTable, this.relationName)
  }
}

export class DBDescription<T extends TableDescriptions> {
  public extendedTables: ExtendedTableDescriptions
  constructor(public tables: T) {
    this.extendedTables = this.extend(tables)
  }

  private extend(tbls: T): ExtendedTableDescriptions {
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

  getTableDescription(
    table: TableName
  ): ExtendedTableDescription<
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    URIS
  > {
    return this.extendedTables[table]
  }

  getFields(table: TableName): FieldName[] {
    return this.extendedTables[table].fields
  }

  getRelationName(table: TableName, field: FieldName): RelationName {
    return this.getRelations(table).find((r) => r.relationField === field)!
      .relationName
  }

  getRelation(table: TableName, relation: RelationName): Relation {
    return this.getRelations(table).find((r) => r.relationName === relation)!
  }

  // Profile.post <-> Post.profile (from: profileId, to: id)
  getRelations(table: TableName): Relation[] {
    return this.extendedTables[table].relations
  }

  getOutgoingRelations(table: TableName): Relation[] {
    if (table === 'Post') {
      return [
        new Relation(
          'author',
          'authorId',
          'id',
          'User',
          'PostsToAuthor',
          'one'
        ),
      ]
    } else {
      return []
    }
  }

  getIncomingRelations(table: TableName): Relation[] {
    if (table === 'User') {
      return [new Relation('posts', '', '', 'Post', 'PostsToAuthor', 'many')]
    } else {
      return []
    }
  }
}
