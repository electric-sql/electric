import test from 'ava'

import { DatabaseAdapter } from '../../../src/drivers/node-postgres'
import { PgBundleMigrator as BundleMigrator } from '../../../src/migrators/bundle'
import { makeStmtMigration } from '../../../src/migrators'

import { randomValue } from '../../../src/util/random'

import migrations from '../../support/migrations/pg-migrations.js'
import { makePgDatabase } from '../../support/node-postgres'

let port = 5532
test.beforeEach(async (t) => {
  const dbName = `bundle-migrator-${randomValue()}`
  const { db, stop } = await makePgDatabase(dbName, port++)
  const adapter = new DatabaseAdapter(db)

  t.context = {
    adapter,
    dbName,
    stopPG: stop,
  }
})

test.afterEach.always(async (t) => {
  const { stopPG } = t.context as any
  await stopPG()
})

test('run the bundle migrator', async (t) => {
  const { adapter } = t.context as any

  const migrator = new BundleMigrator(adapter, migrations)
  t.is(await migrator.up(), 3)
  t.is(await migrator.up(), 0)
})

test('applyIfNotAlready applies new migrations', async (t) => {
  const { adapter } = t.context as any

  const allButLastMigrations = migrations.slice(0, -1)
  const lastMigration = makeStmtMigration(migrations[migrations.length - 1])

  const migrator = new BundleMigrator(adapter, allButLastMigrations)
  t.is(await migrator.up(), 2)

  const wasApplied = await migrator.applyIfNotAlready(lastMigration)
  t.assert(wasApplied)
})

test('applyIfNotAlready ignores already applied migrations', async (t) => {
  const { adapter } = t.context as any

  const migrator = new BundleMigrator(adapter, migrations)
  t.is(await migrator.up(), 3)

  const wasApplied = await migrator.applyIfNotAlready(
    makeStmtMigration(migrations[0])
  )
  t.assert(!wasApplied)
})
