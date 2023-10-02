import test from 'ava'

import { ElectricDatabase as Database } from '../../src/drivers/postgres/database'
import { DatabaseAdapter } from '../../src/drivers/postgres/adapter'

import { rm as removeFile } from 'node:fs/promises'
import { AnyDatabase } from '../../src/drivers'

import { BundleMigrator } from '../../src/migrators/bundle'
import { makeStmtMigration } from '../../src/migrators'

import migrations from '../support/migrations/migrations.js'

test.beforeEach(async (t) => {

  const dbName = "./data/db";

  let db = await Database.init(dbName)
  let adapter = new DatabaseAdapter(db)

  t.context = {
    adapter,
    dbName,
  }
})

test.afterEach.always(async (t) => {
  const { dbName, adapter } = t.context as any

  // await pg.stop();
  await (<DatabaseAdapter>adapter).stop()

  // Remove postgres directory
  await removeFile(dbName, { force: true, recursive: true });
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
