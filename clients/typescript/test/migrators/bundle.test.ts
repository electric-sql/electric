import test from 'ava'
import Database from 'better-sqlite3'

import { rm as removeFile } from 'node:fs/promises'

import { DatabaseAdapter } from '../../src/drivers/better-sqlite3/adapter'
import { BundleMigrator } from '../../src/migrators/bundle'
import { makeStmtMigration } from '../../src/migrators'

import { randomValue } from '../../src/util/random'

import config from '../support/.electric/@config/index'
const { migrations } = config

test.beforeEach((t) => {
  const dbName = `bundle-migrator-${randomValue()}.db`
  const db = new Database(dbName)
  const adapter = new DatabaseAdapter(db)

  t.context = {
    adapter,
    dbName,
  }
})

test.afterEach.always(async (t) => {
  const { dbName } = t.context as any

  await removeFile(dbName, { force: true })
  await removeFile(`${dbName}-journal`, { force: true })
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
