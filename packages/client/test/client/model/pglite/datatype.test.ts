import anyTest, { TestFn } from 'ava'

import { MockRegistry } from '../../../../src/satellite/mock'

import { electrify } from '../../../../src/drivers/pglite'
import {
  _NOT_UNIQUE_,
  _RECORD_NOT_FOUND_,
} from '../../../../src/client/validation/errors/messages'
import { schema } from '../../generated'
import { ContextType, datatypeTests } from '../datatype'
import { PGlite } from '@electric-sql/pglite'

// Run all tests in this file serially
// because there are a lot of tests
// and it would lead to PG running out of shared memory
const test = anyTest.serial as TestFn<
  ContextType & {
    stop: () => Promise<void>
  }
>

test.beforeEach(async (t) => {
  const db = new PGlite()
  const electric = await electrify(
    db,
    schema,
    {},
    { registry: new MockRegistry() }
  )

  const tbl = electric.db.DataTypes

  // Sync all shapes such that we don't get warnings on every query
  await tbl.sync()

  await db.query(
    `CREATE TABLE "DataTypes"("id" INT4 PRIMARY KEY, "date" DATE, "time" TIME, "timetz" TIMETZ, "timestamp" TIMESTAMP, "timestamptz" TIMESTAMPTZ, "bool" BOOL, "uuid" UUID, "int2" INT2, "int4" INT4, "int8" INT8, "float4" FLOAT4, "float8" FLOAT8, "json" JSONB, "bytea" BYTEA, "relatedId" INT4);`
  )

  t.context = {
    tbl,
    stop: () => db.close(),
    dialect: 'Postgres',
  }
})

test.afterEach.always(async (t) => {
  await t.context.stop()
})

datatypeTests(test as unknown as TestFn<ContextType>)
