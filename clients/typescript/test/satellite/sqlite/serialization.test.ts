import anyTest, { ExecutionContext, TestFn } from 'ava'
import Database from 'better-sqlite3'
import { DatabaseAdapter as SQLiteDatabaseAdapter } from '../../../src/drivers/better-sqlite3'
import { sqliteBuilder } from '../../../src/migrators/query-builder'
import { opts } from '../common'
import { ContextType, SetupFn, serializationTests } from '../serialization'
import {
  sqliteTypeDecoder,
  sqliteTypeEncoder,
} from '../../../src/util/encoders'

const test = anyTest as TestFn<ContextType>

const setupSqlite: SetupFn = (t: ExecutionContext<unknown>) => {
  const db = new Database(':memory:')
  t.teardown(() => db.close())
  const namespace = 'main'
  return [new SQLiteDatabaseAdapter(db), sqliteBuilder, opts(namespace)]
}

test.beforeEach(async (t) => {
  t.context.dialect = 'SQLite'
  t.context.encoder = sqliteTypeEncoder
  t.context.decoder = sqliteTypeDecoder
  t.context.setup = setupSqlite
})

serializationTests(test)
