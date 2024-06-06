import anyTest, { TestFn } from 'ava'

import { DatabaseAdapter } from '../../../src/drivers/node-postgres'
import { PgBundleMigrator as BundleMigrator } from '../../../src/migrators/bundle'

import { randomValue } from '../../../src/util/random'

import { makePgDatabase } from '@electric-sql/drivers/node-postgres'
import { ContextType, bundleTests } from '../bundle'

import migrations from '../../support/migrations/pg-migrations.js'

const test = anyTest as TestFn<ContextType>

let port = 5532
test.beforeEach(async (t) => {
  const dbName = `bundle-migrator-${randomValue()}`
  const { db, stop } = await makePgDatabase(dbName, port++)
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
