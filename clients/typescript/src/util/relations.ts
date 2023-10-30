
import { SatRelation_RelationType } from '../_generated/protocol/satellite'
import { DatabaseAdapter } from '../electric/adapter'
import { SatelliteOpts } from '../satellite/config'
import { Relation, RelationsCache } from './types'

// TODO: Improve this code once with Migrator and consider simplifying oplog.
export async function inferRelationsFromSQLite(
  adapter: DatabaseAdapter,
  opts: SatelliteOpts
): Promise<{ [k: string]: Relation }> {
  const tableNames = await _getLocalTableNames(adapter, opts)
  const relations: RelationsCache = {}

  let id = 0
  const schema = 'public' // TODO
  for (const table of tableNames) {
    const tableName = table.name
    const sql = 'SELECT * FROM pragma_table_info(?)'
    const args = [tableName]
    const columnsForTable = await adapter.query({ sql, args })
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
    relations[`${tableName}`] = relation
  }

  return Promise.resolve(relations)
}

async function _getLocalTableNames(
  adapter: DatabaseAdapter,
  opts: SatelliteOpts
): Promise<{ name: string }[]> {
  const notIn = [
    opts.metaTable.tablename.toString(),
    opts.migrationsTable.tablename.toString(),
    opts.oplogTable.tablename.toString(),
    opts.triggersTable.tablename.toString(),
    opts.shadowTable.tablename.toString(),
    'sqlite_schema',
    'sqlite_sequence',
    'sqlite_temp_schema',
  ]

  const tables = `
      SELECT name FROM sqlite_master
        WHERE type = 'table'
          AND name NOT IN (${notIn.map(() => '?').join(',')})
    `
  return (await adapter.query({ sql: tables, args: notIn })) as {
    name: string
  }[]
}
