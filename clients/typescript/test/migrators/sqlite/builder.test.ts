import anyTest, { TestFn } from 'ava'
import { makeMigration, parseMetadata } from '../../../src/migrators/builder'
import Database from 'better-sqlite3'
import { DatabaseAdapter } from '../../../src/drivers/better-sqlite3'
import { sqliteBuilder } from '../../../src/migrators/query-builder'
import {
  ContextType,
  bundleTests,
  makeMigrationMetaData,
} from '../builder.test'
import { SqliteBundleMigrator } from '../../../src/migrators'

const test = anyTest as TestFn<ContextType>

test.beforeEach(async (t) => {
  const builder = sqliteBuilder
  const migrationMetaData = makeMigrationMetaData(builder)

  t.context = {
    migrationMetaData,
    builder,
  }
})

bundleTests(test)

test('load migration from meta data', async (t) => {
  const { migrationMetaData, builder } = t.context
  const migration = makeMigration(parseMetadata(migrationMetaData), builder)

  const db = new Database(':memory:')
  const adapter = new DatabaseAdapter(db)
  const migrator = new SqliteBundleMigrator(adapter, [migration])

  // Apply the migration
  await migrator.up()

  // Check that the DB is initialized with the stars table
  const tables = await adapter.query({
    sql: `SELECT name FROM sqlite_master WHERE type='table' AND name='stars';`,
  })

  const starIdx = tables.findIndex((tbl) => tbl.name === 'stars')
  t.assert(starIdx >= 0) // must exist

  const columns = await adapter
    .query({
      sql: `PRAGMA table_info(stars);`,
    })
    .then((columns) => columns.map((column) => column.name))

  t.deepEqual(columns, ['id', 'avatar_url', 'name', 'starred_at', 'username'])
})
