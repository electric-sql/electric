import anyTest, { TestFn } from 'ava'
import Database from 'better-sqlite3'

import { rm as removeFile } from 'node:fs/promises'

import { DatabaseAdapter } from '../../../src/drivers/better-sqlite3/adapter'
import { SqliteBundleMigrator as BundleMigrator } from '../../../src/migrators/bundle'

import { randomValue } from '../../../src/util/random'
import { ContextType, bundleTests } from '../bundle'

import migrations from '../../support/migrations/migrations.js'

const test = anyTest as TestFn<ContextType>

test.beforeEach((t) => {
  const dbName = `bundle-migrator-${randomValue()}.db`
  const db = new Database(dbName)
  const adapter = new DatabaseAdapter(db)

  t.context = {
    dbName,
    adapter,
    migrations,
    BundleMigrator,
    stop: () => Promise.resolve(),
  }
})

test.afterEach.always(async (t) => {
  const { dbName } = t.context as any

  await removeFile(dbName, { force: true })
  await removeFile(`${dbName}-journal`, { force: true })
})

bundleTests(test)
