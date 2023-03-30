import * as z from 'zod'

export type Arity = 'one' | 'many'

export type Relation = {
  relationName: string
  relationField: string
  fromField: string
  toField: string
  relatedTable: string
  relatedObjects: Arity

  isIncomingRelation(): boolean
  isOutgoingRelation(): boolean
  getOppositeRelation(dbDescription: DBDescription): Relation
}

export type TableName = string
export type FieldName = string
export type RelationName = string

export interface DBDescription {
  getSchema(table: TableName): z.ZodSchema<any>
  getFields(table: TableName): string[]
  getRelationName(table: TableName, field: FieldName): RelationName | undefined
  getRelation(table: TableName, relation: RelationName): Relation | undefined
  getRelations(table: TableName): Relation[]
  getOutgoingRelations(table: TableName): Relation[]
  getIncomingRelations(table: TableName): Relation[]
}
