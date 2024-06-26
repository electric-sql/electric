import test from 'ava'
import Database from 'better-sqlite3'
import { electrify } from '../../../src/drivers/better-sqlite3'
import { schema } from '../generated'
import { InvalidArgumentError } from '../../../src/client/validation/errors/invalidArgumentError'
import { MockRegistry } from '../../../src/satellite/mock'
/*
 * This test file is meant to check that the DAL
 * reports unrecognized/unsupported arguments
 * through both type errors and runtime errors.
 */

const db = new Database(':memory:')
const electric = await electrify(
  db,
  schema,
  {},
  { registry: new MockRegistry() }
)

test.beforeEach((_t) => {
  db.exec('DROP TABLE IF EXISTS User')
  db.exec(
    "CREATE TABLE IF NOT EXISTS User('id' int PRIMARY KEY, 'name' varchar, 'meta' varchar);"
  )
})

test('raw insert query throws error for unsupported unsafe queries', async (t) => {
  await t.throwsAsync(
    async () => {
      await electric.db.rawQuery({
        sql: `INSERT INTO "User" (id, name) VALUES (1, 'John Doe')`,
      })
    },
    {
      instanceOf: InvalidArgumentError,
      message:
        'Cannot use queries that might alter the store - please use read-only queries',
    }
  )
})

test('raw update query throws error for unsupported unsafe queries', async (t) => {
  await t.throwsAsync(
    async () => {
      await electric.db.rawQuery({
        sql: `UPDATE "User" SET name = 'New Name' WHERE id = 1;`,
      })
    },
    {
      instanceOf: InvalidArgumentError,
      message:
        'Cannot use queries that might alter the store - please use read-only queries',
    }
  )
})

test('raw delete query throws error for unsupported unsafe queries', async (t) => {
  await t.throwsAsync(
    async () => {
      await electric.db.rawQuery({
        sql: `DELETE FROM "User" WHERE id = 1;`,
      })
    },
    {
      instanceOf: InvalidArgumentError,
      message:
        'Cannot use queries that might alter the store - please use read-only queries',
    }
  )
})

test('raw drop table query throws error for unsupported unsafe queries', async (t) => {
  await t.throwsAsync(
    async () => {
      await electric.db.rawQuery({
        sql: `DROP TABLE IF EXISTS "User"`,
      })
    },
    {
      instanceOf: InvalidArgumentError,
      message:
        'Cannot use queries that might alter the store - please use read-only queries',
    }
  )
})

test('raw create table query throws error for unsupported unsafe queries', async (t) => {
  await t.throwsAsync(
    async () => {
      await electric.db.rawQuery({
        sql: `CREATE TABLE IF NOT EXISTS "User"('id' int PRIMARY KEY, 'name' varchar);`,
      })
    },
    {
      instanceOf: InvalidArgumentError,
      message:
        'Cannot use queries that might alter the store - please use read-only queries',
    }
  )
})

test('liveRaw insert query throws error for unsupported unsafe queries', async (t) => {
  await t.throwsAsync(
    async () => {
      await electric.db.liveRawQuery({
        sql: `INSERT INTO "User" (id, name) VALUES (1, 'John Doe')`,
      })()
    },
    {
      instanceOf: InvalidArgumentError,
      message:
        'Cannot use queries that might alter the store - please use read-only queries',
    }
  )
})
