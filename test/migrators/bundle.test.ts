import test from 'ava'
import Database from 'better-sqlite3'

import { rm as removeFile } from 'node:fs/promises'

import { DatabaseAdapter } from '../../src/drivers/better-sqlite3/adapter'
import { BundleMigrator } from '../../src/migrators/bundle'

import { randomValue } from '../../src/util/random'

import { data as testMigrationsData } from '../support/migrations'
const { migrations } = testMigrationsData

test.beforeEach(t => {
  const dbName = `bundle-migrator-${randomValue()}.db`
  const db = new Database(dbName)
  const adapter = new DatabaseAdapter(db)

  t.context = {
    adapter,
    dbName
  }
})

test.afterEach.always(async t => {
  const { dbName } = t.context as any

  await removeFile(dbName, {force: true})
  await removeFile(`${dbName}-journal`, {force: true})
})

test('run the bundle migrator', async t => {
  const { adapter } = t.context as any

  const migrator = new BundleMigrator(adapter, migrations)
  t.is(await migrator.up(), 2)
  t.is(await migrator.up(), 0)
})
