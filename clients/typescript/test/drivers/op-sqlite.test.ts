import test from 'ava'

import { DatabaseAdapter } from '../../src/drivers/op-sqlite/adapter'
import { MockDatabase } from '../../src/drivers/op-sqlite/mock'

test('database adapter run works', async (t) => {
  const db = new MockDatabase('test.db')
  const adapter = new DatabaseAdapter(db)

  const sql = 'select * from electric'
  const result = await adapter._run({ sql })
  t.is(result.rowsAffected, 1)
})

test('database adapter query works', async (t) => {
  const db = new MockDatabase('test.db')
  const adapter = new DatabaseAdapter(db)

  const sql = 'select * from electric'
  const result = await adapter._query({ sql })
  t.deepEqual(result, [
    {
      column1: 'text1',
      column2: 'text2',
    },
  ])
})

test('database adapter execute batch works', async (t) => {
  const db = new MockDatabase('test.db')
  const adapter = new DatabaseAdapter(db)

  const sql = [
    { sql: 'select * from electric;', args: [] },
    { sql: 'select * from opsqlite', args: [] },
  ]
  const result = await adapter.execBatch(sql)

  t.is(result.rowsAffected, 1)
})

test('database adapter reject promise on failure', async (t) => {
  const err = new Error('Test Failure')
  const db = new MockDatabase('test.db', err)
  const adapter = new DatabaseAdapter(db)
  const sql = 'select * from electric'

  const assertFailure = async (promise: Promise<any>) => {
    await t.throwsAsync(promise, { instanceOf: Error, message: err.message })
  }
  const batchQuery = [
    { sql: 'select * from electric;', args: [] },
    { sql: 'select * from opsqlite', args: [] },
  ]
  await assertFailure(adapter._run({ sql }))
  await assertFailure(adapter._query({ sql }))
  await assertFailure(adapter.execBatch(batchQuery))
})
