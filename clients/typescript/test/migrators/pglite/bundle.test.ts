import anyTest, { TestFn } from 'ava'

import { DatabaseAdapter } from '../../../src/drivers/pglite'
import { PgBundleMigrator as BundleMigrator } from '../../../src/migrators/bundle'

import { randomValue } from '../../../src/util/random'

import { PGlite } from '@electric-sql/pglite'
import { ContextType, bundleTests } from '../bundle.test'

import migrations from '../../support/migrations/pg-migrations.js'

const test = anyTest as TestFn<ContextType>

test.beforeEach(async (t) => {
  const dbName = `bundle-migrator-${randomValue()}`
  const db = new PGlite()
  const stop = () => db.close()
  const adapter = new DatabaseAdapter(db)

  t.context = {
    dbName,
    adapter,
    migrations,
    BundleMigrator,
    stop,
  }
})

test.afterEach.always(async (t) => {
  const { stop } = t.context as ContextType
  await stop()
})

bundleTests(test)
