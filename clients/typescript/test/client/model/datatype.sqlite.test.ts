import anyTest, { TestFn } from 'ava'
import Database from 'better-sqlite3'
import type { Database as BetterSqlite3Database } from 'better-sqlite3'

import { MockRegistry } from '../../../src/satellite/mock'

import { electrify } from '../../../src/drivers/better-sqlite3'
import {
  _NOT_UNIQUE_,
  _RECORD_NOT_FOUND_,
} from '../../../src/client/validation/errors/messages'
import { schema } from '../generated'
import { ContextType, datatypeTests } from './datatype.test'

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

  const tbl = electric.db.DataTypes

  // Sync all shapes such that we don't get warnings on every query
  await tbl.sync()

  db.exec(
    "CREATE TABLE DataTypes('id' int PRIMARY KEY, 'date' varchar, 'time' varchar, 'timetz' varchar, 'timestamp' varchar, 'timestamptz' varchar, 'bool' int, 'uuid' varchar, 'int2' int2, 'int4' int4, 'int8' int8, 'float4' real, 'float8' real, 'json' varchar, 'bytea' blob, 'relatedId' int);"
  )

  t.context = {
    db,
    tbl,
  }
})

test.afterEach.always((t) => {
  t.context.db.close()
})

datatypeTests(test as unknown as TestFn<ContextType>)
