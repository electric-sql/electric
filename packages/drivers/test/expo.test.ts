import test from 'ava'

import { MockDatabase } from '../src/expo-sqlite/mock.js'
import { DatabaseAdapter } from '../src/expo-sqlite/adapter.js'

test('database adapter run works', async (t) => {
  const db = new MockDatabase('test.db')
  const adapter = new DatabaseAdapter(db)

  const sql = 'drop table badgers'
  const result = await adapter.run({ sql })

  t.is(result.rowsAffected, 0)
})

test('database adapter query works', async (t) => {
  const db = new MockDatabase('test.db')
  const adapter = new DatabaseAdapter(db)

  const sql = 'select foo from bars'
  const result = await adapter.query({ sql })

  t.deepEqual(result, [{ i: 0 }])
})
