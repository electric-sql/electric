import anyTest, { TestFn } from 'ava'
import Database from 'better-sqlite3'
import type { Database as BetterSqlite3Database } from 'better-sqlite3'

import { MockRegistry } from '../../../../src/satellite/mock'

import { electrify } from '../../../../src/drivers/better-sqlite3'
import { schema } from '../../generated'
import { ContextType, datatypeTests } from '../datatype'
import { sqliteBuilder } from '../../../../src/migrators/query-builder'
import { sqliteConverter } from '../../../../src/client/conversions'

const test = anyTest as TestFn<
  ContextType & {
    db: BetterSqlite3Database
  }
>

test.beforeEach(async (t) => {
  const db = new Database(':memory:')
  const electric = await electrify(
    db,
    schema,
    {},
    { registry: new MockRegistry() }
  )

  db.exec(
    "CREATE TABLE DataTypes('id' int PRIMARY KEY, 'date' varchar, 'time' varchar, 'timetz' varchar, 'timestamp' varchar, 'timestamptz' varchar, 'bool' int, 'uuid' varchar, 'int2' int2, 'int4' int4, 'int8' int8, 'float4' real, 'float8' real, 'json' varchar, 'bytea' blob, 'relatedId' int);"
  )

  t.context = {
    db,
    electric,
    builder: sqliteBuilder,
    converter: sqliteConverter,
    dialect: 'SQLite',
  }
})

test.afterEach.always((t) => {
  t.context.db.close()
})

datatypeTests(test as unknown as TestFn<ContextType>)
