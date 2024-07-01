import anyTest, { ExecutionContext, TestFn } from 'ava'
import { PGlite } from '@electric-sql/pglite'
import { opts } from '../common'
import { ContextType, SetupFn, serializationTests } from '../serialization'
import { pgTypeDecoder, pgTypeEncoder } from '../../../src/util/encoders'
import { DatabaseAdapter as PgDatabaseAdapter } from '../../../src/drivers/pglite'
import { pgBuilder } from '../../../src/migrators/query-builder'

const test = anyTest as TestFn<ContextType>

const setupPG: SetupFn = async (t: ExecutionContext<unknown>) => {
  const db = new PGlite()
  const stop = () => db.close()
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
