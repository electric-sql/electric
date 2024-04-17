import { TestFn } from 'ava'
import { DatabaseAdapter } from '../../src/electric'
import { Dialect } from '../../src/migrators/query-builder/builder'
import { Table } from '../../src/migrators/triggers'
import { SatelliteOpts } from '../../src/satellite/config'

export type ContextType = {
  adapter: DatabaseAdapter
  dialect: Dialect
  defaults: SatelliteOpts
  personTable: Table
  migrateDb: () => Promise<void>
  stopDb: () => Promise<void>
}

export const triggerTests = (test: TestFn<ContextType>) => {
  test('oplog trigger should separate null blobs from empty blobs', async (t) => {
    const { adapter, migrateDb, dialect, personTable, defaults } = t.context
    const namespace = personTable.namespace
    const tableName = personTable.tableName

    // Migrate the DB with the necessary tables and triggers
    await migrateDb()

    // Insert null and empty rows in the table
    const insertRowNullSQL = `INSERT INTO "${namespace}"."${tableName}" (id, name, age, bmi, int8, blob) VALUES (1, 'John Doe', 30, 25.5, 7, NULL)`
    const blobValue = dialect === 'Postgres' ? `'\\x'` : `x''`
    const insertRowEmptySQL = `INSERT INTO "${namespace}"."${tableName}" (id, name, age, bmi, int8, blob) VALUES (2, 'John Doe', 30, 25.5, 7, ${blobValue})`
    await adapter.run({ sql: insertRowNullSQL })
    await adapter.run({ sql: insertRowEmptySQL })

    // Check that the oplog table contains an entry for the inserted row
    const oplogRows = await adapter.query({
      sql: `SELECT * FROM "${defaults.oplogTable.namespace}"."${defaults.oplogTable.tablename}"`,
    })
    t.is(oplogRows.length, 2)
    t.regex(oplogRows[0].newRow as string, /,\s*"blob":\s*null\s*,/)
    t.regex(oplogRows[1].newRow as string, /,\s*"blob":\s*""\s*,/)
  })
}
