import test from 'ava'
import Long from 'long'
import { makeContext, cleanAndStopSatellite } from './common'
import { DatabaseAdapter } from '../../src/drivers/better-sqlite3'
import { Row, Statement } from '../../src/util'
import { SatOpMigrate_Type } from '../../src/_generated/protocol/satellite'

test.beforeEach(async (t: any) => {
  await makeContext(t)
  const { satellite } = t.context as any
  await satellite.start()
  t.context['clientId'] = satellite['_authState']['clientId'] // store clientId in the context
  await populateDB(t)
  const txDate = await satellite._performSnapshot()
  t.context['txDate'] = txDate
})
test.afterEach.always(cleanAndStopSatellite)

const populateDB = async (t: any) => {
  const adapter = t.context.adapter as DatabaseAdapter

  const stmts: Statement[] = []

  stmts.push({
    sql: `INSERT INTO parent (id, value, other) VALUES (?, ?, ?);`,
    args: [1, 'local', null],
  })
  stmts.push({
    sql: `INSERT INTO parent (id, value, other) VALUES (?, ?, ?);`,
    args: [2, 'local', null],
  })
  await adapter.runInTransaction(...stmts)
}

async function assertDbHasTables(t: any, ...tables: string[]) {
  const adapter = t.context.adapter as DatabaseAdapter
  const schemaRows = await adapter.query({
    sql: "SELECT tbl_name FROM sqlite_schema WHERE type = 'table'",
  })

  const tableNames = new Set(schemaRows.map((r) => r.tbl_name))
  tables.forEach((tbl) => {
    t.true(tableNames.has(tbl))
  })
}

async function getTableInfo(table: string, t: any): Promise<ColumnInfo[]> {
  const adapter = t.context.adapter as DatabaseAdapter
  return (await adapter.query({
    sql: `pragma table_info(${table});`,
  })) as ColumnInfo[]
}

type ColumnInfo = {
  cid: number
  name: string
  type: string
  notnull: number
  dflt_value: null | string
  pk: number
}

test('setup populates DB', async (t: any) => {
  const adapter = t.context.adapter as DatabaseAdapter

  const sql = 'SELECT * FROM parent'
  const rows = await adapter.query({ sql })
  t.deepEqual(rows, [
    {
      id: 1,
      value: 'local',
      other: null,
    },
    {
      id: 2,
      value: 'local',
      other: null,
    },
  ])
})

test('apply migration containing only DDL', async (t: any) => {
  const { satellite, adapter, txDate } = t.context
  const timestamp = txDate.getTime()

  const fetchParentRows = async (): Promise<Row[]> => {
    return adapter.query({
      sql: 'SELECT * FROM parent',
    })
  }

  const rowsBeforeMigration = await fetchParentRows()

  const createTable = {
    migrationType: SatOpMigrate_Type.CREATE_TABLE,
    sql: 'CREATE TABLE NewTable(\
         id TEXT NOT NULL,\
         foo INTEGER,\
         bar TEXT,\
         PRIMARY KEY(id)\
       );',
  }

  const addColumn = {
    migrationType: SatOpMigrate_Type.ALTER_ADD_COLUMN,
    sql: 'ALTER TABLE parent ADD baz TEXT',
  }

  const migrationTx = {
    origin: 'remote',
    commit_timestamp: Long.fromNumber(timestamp),
    changes: [createTable, addColumn],
    lsn: new Uint8Array(),
  }

  // Apply the migration transaction
  await satellite._applyTransaction(migrationTx)

  // Check that the migration was successfully applied
  await assertDbHasTables(t, 'parent', 'child', 'NewTable')

  const newTableInfo = await getTableInfo('NewTable', t)

  t.deepEqual(newTableInfo, [
    // id, foo, bar
    { cid: 0, name: 'id', type: 'TEXT', notnull: 1, dflt_value: null, pk: 1 },
    {
      cid: 1,
      name: 'foo',
      type: 'INTEGER',
      notnull: 0,
      dflt_value: null,
      pk: 0,
    },
    { cid: 2, name: 'bar', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
  ])

  const parentTableInfo = await getTableInfo('parent', t)
  const parentTableHasColumn = parentTableInfo.some((col: ColumnInfo) => {
    return (
      col.name === 'baz' &&
      col.type === 'TEXT' &&
      col.notnull === 0 &&
      col.dflt_value === null &&
      col.pk === 0
    )
  })

  t.true(parentTableHasColumn)

  // Check that the existing rows are still there and are unchanged
  const rowsAfterMigration = await fetchParentRows()
  const expectedRowsAfterMigration = rowsBeforeMigration.map((row: Row) => {
    return {
      ...row,
      baz: null,
    }
  })

  t.deepEqual(rowsAfterMigration, expectedRowsAfterMigration)
})
