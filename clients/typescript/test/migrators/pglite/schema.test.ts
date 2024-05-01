import test from 'ava'

import { Database, DatabaseAdapter } from '../../../src/drivers/pglite'
import { PgBundleMigrator as BundleMigrator } from '../../../src/migrators/bundle'
import { satelliteDefaults } from '../../../src/satellite/config'

import { randomValue } from '../../../src/util/random'

import migrations from '../../support/migrations/pg-migrations.js'
import { PGlite } from '@electric-sql/pglite'

type Context = {
  dbName: string
  adapter: DatabaseAdapter
  db: Database
  stopPG: () => Promise<void>
}

test.beforeEach(async (t) => {
  const dbName = `schema-migrations-${randomValue()}`
  const db = new PGlite()
  const stop = () => db.close()
  const adapter = new DatabaseAdapter(db)

  t.context = {
    adapter,
    dbName,
    stopPG: stop,
  }
})

test.afterEach.always(async (t) => {
  const { stopPG } = t.context as Context
  await stopPG()
})

test('check schema keys are unique', async (t) => {
  const { adapter } = t.context as Context

  const migrator = new BundleMigrator(adapter, migrations)
  await migrator.up()
  const defaults = satelliteDefaults(migrator.queryBuilder.defaultNamespace)
  const metaTable = `${defaults.metaTable}`

  await adapter.run({
    sql: `INSERT INTO ${metaTable} (key, value) values ('key', 'value')`,
  })
  try {
    await adapter.run({
      sql: `INSERT INTO ${metaTable} (key, value) values ('key', 'value')`,
    })
    t.fail()
  } catch (err) {
    const castError = err as { code: string; detail: string }
    t.is(castError.code, '23505')
    t.is(castError.detail, 'Key (key)=(key) already exists.')
  }
})
