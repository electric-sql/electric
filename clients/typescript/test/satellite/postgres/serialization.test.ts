import anyTest, { ExecutionContext, TestFn } from 'ava'
import { makePgDatabase } from '../../support/node-postgres'
import { randomValue } from '../../../src/util/random'
import { opts } from '../common'
import { ContextType, SetupFn, serializationTests } from '../serialization'
import { pgTypeDecoder, pgTypeEncoder } from '../../../src/util/encoders'
import { DatabaseAdapter as PgDatabaseAdapter } from '../../../src/drivers/node-postgres/adapter'
import { pgBuilder } from '../../../src/migrators/query-builder'

const test = anyTest as TestFn<ContextType>

let port = 4800
const setupPG: SetupFn = async (t: ExecutionContext<unknown>) => {
  const dbName = `serialization-test-${randomValue()}`
  const { db, stop } = await makePgDatabase(dbName, port++)
  t.teardown(async () => await stop())
  const namespace = 'public'
  return [new PgDatabaseAdapter(db), pgBuilder, opts(namespace)]
}

test.beforeEach(async (t) => {
  t.context.dialect = 'Postgres'
  t.context.encoder = pgTypeEncoder
  t.context.decoder = pgTypeDecoder
  t.context.setup = setupPG
})

serializationTests(test)
