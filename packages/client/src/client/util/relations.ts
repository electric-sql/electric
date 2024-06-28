import groupBy from 'lodash.groupby'
import keyBy from 'lodash.keyby'
import {
  SatOpMigrate_ForeignKey,
  SatOpMigrate_Table,
} from '../../_generated/protocol/satellite'
import { TableName, Relation, Fields } from '../model/schema'
import { PgType } from '../conversions/types'

function makeRelation(
  table: SatOpMigrate_Table,
  fk: SatOpMigrate_ForeignKey,
  groupedFks: Record<string, SatOpMigrate_ForeignKey[]>,
  allTables: KeyedTables
): Relation {
  const childTable = table.name
  const childCols = fk.fkCols
  const parentCols = fk.pkCols
  const parentTable = fk.pkTable

  if (childCols.length > 1 || parentCols.length > 1) {
    throw new Error('Composite foreign keys are not supported')
  }

  const childCol = childCols[0]
  const parentCol = parentCols[0]

  // If there is only a single foreign key to a certain parent table
  // and there is no column that is named after the parent table
  // and there is no FK from the parent table to the child table
  // then we can name the relation field the same as the parent table name
  // otherwise the relation field name is the relation name prefixed with the name of the related table
  const noColNamedAfterParent = table.columns.every(
    (col) => col.name !== parentTable
  )
  const singleFk = groupedFks[parentTable].length === 1
  const fkFromParentToChild = allTables[parentTable]!.fks.find(
    (fk) => fk.pkTable === childTable
  )

  const relationName = `${childTable}_${childCol}To${parentTable}`
  const relationFieldName =
    singleFk && noColNamedAfterParent && !fkFromParentToChild
      ? parentTable
      : `${parentTable}_${relationName}`

  return new Relation(
    relationFieldName,
    childCol,
    parentCol,
    parentTable,
    relationName,
    'one'
  )
}

export type GroupedRelations = Map<TableName, Array<Relation>>
export type KeyedTables = Record<TableName, SatOpMigrate_Table>

/**
 * Creates a `Relation` object for each FK in the table,
 * as well as the opposite `Relation` object in order to
 * be able to traverse the relation in the opposite direction.
 * As a result, this function returns a map of relations grouped by table name.
 */
export function createRelationsFromTable(
  table: SatOpMigrate_Table,
  allTables: KeyedTables
): GroupedRelations {
  const childTable = table.name
  const fks = table.fks
  const groupedFks = groupBy(fks, (fk) => fk.pkTable)

  const groupedRelations: GroupedRelations = new Map()
  const extendGroupedRelations = (tableName: TableName, relation: Relation) => {
    const relations = groupedRelations.get(tableName) ?? []
    relations.push(relation)
    groupedRelations.set(tableName, relations)
  }

  // For each FK make a `Relation`
  const forwardRelations = fks.map((fk) => {
    const rel = makeRelation(table, fk, groupedFks, allTables)
    // Store the relation in the `groupedRelations` map
    extendGroupedRelations(childTable, rel)
    return rel
  })

  // For each FK, also create the opposite `Relation`
  // in order to be able to follow the relation in both directions
  forwardRelations.forEach((relation) => {
    const parentTableName = relation.relatedTable
    const parentTable = allTables[parentTableName]!
    const parentFks = parentTable.fks
    // If the parent table also has a FK to the child table
    // than there is ambuigity because we can follow this FK
    // or we could follow the FK that points to this table in the opposite direction
    const fkToChildTable = parentFks.find(
      (fk) => fk.pkTable === childTable && fk.fkCols[0] !== relation.toField // checks if this is another FK to the same table, assuming no composite FKs
    )
    // Also check if there are others FKs from the child table to this table
    const childFks = allTables[childTable]!.fks
    const otherFksToParentTable = childFks.find(
      (fk) =>
        fk.pkTable === parentTableName && fk.fkCols[0] !== relation.fromField // checks if this is another FK from the child table to this table, assuming no composite FKs
    )
    const noColNamedAfterParent = parentTable.columns.every(
      (col) => col.name !== childTable
    )

    // Make the relation field name
    // which is the name of the related table (if it is unique)
    // otherwise it is the relation name prefixed with the name of the related table
    const relationFieldName =
      !fkToChildTable && !otherFksToParentTable && noColNamedAfterParent
        ? childTable
        : `${childTable}_${relation.relationName}`

    const backwardRelation = new Relation(
      relationFieldName,
      '',
      '',
      childTable,
      relation.relationName,
      'many' // TODO: what about 1-to-1 relations? Do we still need this arity?
    )

    // Store the backward relation in the `groupedRelations` map
    extendGroupedRelations(parentTableName, backwardRelation)
  })

  return groupedRelations
}

function mergeGroupedRelations(
  groupedRelations: GroupedRelations,
  relations: GroupedRelations
) {
  relations.forEach((relations, tableName) => {
    const existingRelations = groupedRelations.get(tableName) ?? []
    groupedRelations.set(tableName, existingRelations.concat(relations))
  })
}

export function createRelationsFromAllTables(
  tables: Array<SatOpMigrate_Table>
): GroupedRelations {
  const keyedTables: KeyedTables = keyBy(tables, 'name')
  const groupedRelations: GroupedRelations = new Map()
  tables.forEach((table) => {
    const relations = createRelationsFromTable(table, keyedTables)
    mergeGroupedRelations(groupedRelations, relations)
  })
  return groupedRelations
}

// TODO: remove the DbSchema type from the DAL and use this one instead
export type DbSchema = Record<
  TableName,
  { fields: Fields; relations: Array<Relation> }
>
export function createDbDescription(
  tables: Array<SatOpMigrate_Table>
): DbSchema {
  const relations = createRelationsFromAllTables(tables)
  const dbDescription: DbSchema = {}
  tables.forEach((table) => {
    const tableName = table.name
    const rels = relations.get(tableName) ?? []
    const fields: Fields = {}
    table.columns.forEach(
      (col) => (fields[col.name] = col.pgType!.name.toUpperCase() as PgType)
    )

    dbDescription[tableName] = {
      fields,
      relations: rels,
    }
  })
  return dbDescription
}
