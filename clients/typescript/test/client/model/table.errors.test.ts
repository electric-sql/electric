import test from 'ava'
import Database from 'better-sqlite3'
import { electrify } from '../../../src/drivers/better-sqlite3'
import { dbSchema } from '../generated'
import { ZodError } from 'zod'

/*
 * This test file is meant to check that the DAL
 * reports unrecognized/unsupported arguments
 * through both type errors and runtime errors.
 */

const db = new Database(':memory:')
const electric = await electrify(db, dbSchema, {
  app: 'CRUD-Test',
  env: 'env',
  migrations: [],
})
//const postTable = electric.db.Post
const userTable = electric.db.User

test('create query throws error for unsupported arguments', async (t) => {
  await t.throwsAsync(
    async () => {
      await userTable.create({
        data: {
          id: 1,
          name: 't1',
        },
        select: {
          // @ts-expect-error
          _count: true,
        },
      })
    },
    { instanceOf: ZodError }
  )

  //console.log('error is: ' + err.name + ' - ' + err.message)
})
