import test from 'ava'
import Database from 'better-sqlite3'

import { rm as removeFile } from 'node:fs/promises'
import { AnyDatabase } from '../../src/drivers'

import { DatabaseAdapter } from '../../src/drivers/better-sqlite3/adapter'
import { BundleMigrator } from '../../src/migrators/bundle'
import { satelliteDefaults } from '../../src/satellite/config'

import { randomValue } from '../../src/util/random'

import { data as testMigrationsData } from '../support/migrations'
const { migrations } = testMigrationsData

type Context = {
  dbName: string
  adapter: DatabaseAdapter
  db: AnyDatabase
}

test.beforeEach((t) => {
  const dbName = `schema-migrations-${randomValue()}.db`
  const db = new Database(dbName)
  const adapter = new DatabaseAdapter(db)

  t.context = {
    adapter,
    dbName,
  }
})

test.afterEach.always(async (t) => {
  const { dbName } = t.context as Context

  await removeFile(dbName, { force: true })
  await removeFile(`${dbName}-journal`, { force: true })
})

test('check schema keys are unique', async (t) => {
  const { adapter } = t.context as Context

  const migrator = new BundleMigrator(adapter, migrations)
  await migrator.up()

  await adapter.run({
    sql: `INSERT INTO ${satelliteDefaults.metaTable}(key, value) values ('key', 'value')`,
  })
  try {
    await adapter.run({
      sql: `INSERT INTO ${satelliteDefaults.metaTable}(key, value) values ('key', 'value')`,
    })
    t.fail()
  } catch (err) {
    const castError = err as { code: string }
    t.is(castError.code, 'SQLITE_CONSTRAINT_PRIMARYKEY')
  }
})
