import test from 'ava'

import { DatabaseAdapter } from '../../src/drivers/react-native-sqlite-storage/adapter'
import { MockDatabase } from '../../src/drivers/react-native-sqlite-storage/mock'
import { QualifiedTablename } from '../../src/util/tablename'
import { SQLError } from 'react-native-sqlite-storage'

test('database adapter run works', async (t) => {
  const db = new MockDatabase('test.db')
  const adapter = new DatabaseAdapter(db, false)

  const sql = 'drop table badgers'
  const result = await adapter.run({ sql })

  t.is(result.rowsAffected, 0)
})

test('database adapter run works [promisesEnabled]', async (t) => {
  const db = new MockDatabase('test.db')
  const adapter = new DatabaseAdapter(db, true)

  const sql = 'drop table badgers'
  const result = await adapter.run({ sql })

  t.is(result.rowsAffected, 0)
})

test('database adapter query works', async (t) => {
  const db = new MockDatabase('test.db')
  const adapter = new DatabaseAdapter(db, false)

  const sql = 'select foo from bars'
  const result = await adapter.query({ sql })

  t.deepEqual(result, [{ i: 0 }])
})

test('database adapter query works [promisesEnabled]', async (t) => {
  const db = new MockDatabase('test.db')
  const adapter = new DatabaseAdapter(db, true)

  const sql = 'select foo from bars'
  const result = await adapter.query({ sql })

  t.deepEqual(result, [{ i: 0 }])
})

test('database adapter run failure throws', async (t) => {
  const db = new MockDatabase('test.db', new MockError(1, 'test'))
  const adapter = new DatabaseAdapter(db, false)

  const sql = 'drop table badgers'
  await t.throwsAsync(() => adapter.run({ sql }))
})

test('database adapter run failure throws [promisesEnabled]', async (t) => {
  const db = new MockDatabase('test.db', new MockError(1, 'test'))
  const adapter = new DatabaseAdapter(db, true)

  const sql = 'drop table badgers'
  await t.throwsAsync(() => adapter.run({ sql }))
})

test('database adapter tableNames works', async (t) => {
  const db = new MockDatabase('test.db')
  const adapter = new DatabaseAdapter(db, false)

  const sql = 'select foo from bar'
  const r1 = adapter.tableNames({ sql })

  t.deepEqual(r1, [new QualifiedTablename('main', 'bar')])
})

class MockError extends Error implements SQLError {
  constructor(public code: number, public message: string) {
    super(message)
  }
}
