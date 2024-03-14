import { SatRelation_RelationType } from '../_generated/protocol/satellite'
import { DatabaseAdapter } from '../electric/adapter'
import { QueryBuilder } from '../migrators/query-builder'
import { SatelliteOpts } from '../satellite/config'
import { Relation, RelationsCache } from './types'

// TODO: Improve this code once with Migrator and consider simplifying oplog.
export async function inferRelationsFromDb(
  adapter: DatabaseAdapter,
  opts: SatelliteOpts,
  builder: QueryBuilder
): Promise<{ [k: string]: Relation }> {
  const tableNames = await _getLocalTableNames(adapter, opts, builder)
  const relations: RelationsCache = {}

  let id = 0
  const schema = 'public' // TODO
  for (const table of tableNames) {
    const tableName = table.name
    const columnsForTable = await adapter.query(builder.getTableInfo(tableName))
    if (columnsForTable.length == 0) {
      continue
    }
    const relation: Relation = {
      id: id++,
      schema: schema,
      table: tableName,
      tableType: SatRelation_RelationType.TABLE,
      columns: [],
    }
    for (const c of columnsForTable) {
      relation.columns.push({
        name: c.name!.toString(),
        type: c.type!.toString(),
        isNullable: Boolean(!c.notnull!.valueOf()),
        primaryKey: Boolean(c.pk!.valueOf()),
      })
    }
    relations[tableName] = relation
  }

  return relations
}

async function _getLocalTableNames(
  adapter: DatabaseAdapter,
  opts: SatelliteOpts,
  builder: QueryBuilder
): Promise<{ name: string }[]> {
  const notIn = [
    opts.metaTable.tablename.toString(),
    opts.migrationsTable.tablename.toString(),
    opts.oplogTable.tablename.toString(),
    opts.triggersTable.tablename.toString(),
    opts.shadowTable.tablename.toString(),
  ]

  const rows = await adapter.query(builder.getLocalTableNames(notIn))
  return rows as Array<{ name: string }>
}
