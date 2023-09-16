import test from 'ava'

import { ElectricDatabase as Database } from '../../src/drivers/postgres/database'
import { DatabaseAdapter } from '../../src/drivers/postgres/adapter'

import { rm as removeFile } from 'node:fs/promises'
import { AnyDatabase } from '../../src/drivers'

import { BundleMigrator } from '../../src/migrators/bundle'
import { satelliteDefaults } from '../../src/satellite/config'

import migrations from '../support/migrations/migrations.js'

type Context = {
  dbName: string
  adapter: DatabaseAdapter
  db: AnyDatabase
}

test.beforeEach(async (t) => {
  const dbName = "./data/db"
  const db = await Database.init(dbName)
  const adapter = new DatabaseAdapter(db)

  t.context = {
    adapter,
    dbName,
  }
})

test.afterEach.always(async (t) => {
  const { dbName, adapter  } = t.context as Context

  await adapter.stop()
  await removeFile(dbName, { force: true, recursive: true });
})

test('check schema keys are unique', async (t) => {
  const { adapter, dbName } = t.context as Context

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
    // https://www.postgresql.org/docs/current/errcodes-appendix.html
    t.is(castError.code, '23505')
  }
})
