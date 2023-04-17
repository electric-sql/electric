import test from 'ava'

import { DatabaseAdapter } from '../../src/drivers/react-native-sqlite-storage/adapter'
import { MockDatabase } from '../../src/drivers/react-native-sqlite-storage/mock'
import { initTestable } from '../../src/drivers/react-native-sqlite-storage/test'
import { QualifiedTablename } from '../../src/util/tablename'

test('electrify returns an equivalent database client', async (t) => {
  const [original, _notifier, db] = await initTestable('test.db')

  const originalKeys = Object.getOwnPropertyNames(original)
  const originalPrototype = Object.getPrototypeOf(original)
  const allKeys = originalKeys.concat(Object.keys(originalPrototype))

  allKeys.forEach((key) => {
    t.assert(key in db)
  })
})

test('running a transaction runs potentiallyChanged', async (t) => {
  const [_original, notifier, db] = await initTestable('test.db')

  t.is(notifier.notifications.length, 0)

  db.transaction((tx) => {
    tx.executeSql('insert foo into bar')
  })

  t.is(notifier.notifications.length, 1)
})

test('working with the promise runtime works', async (t) => {
  const [_original, notifier, db] = await initTestable('test.db', true)

  t.is(notifier.notifications.length, 0)

  await db.attach('lala.db', 'lala')
  await db.transaction(async (tx) => {
    await tx.executeSql('INSERT foo INTO bar')
  })

  t.is(notifier.notifications.length, 2)
})

test('database adapter run works', async (t) => {
  const db = new MockDatabase('test.db')
  const adapter = new DatabaseAdapter(db, false)

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

test('database adapter tableNames works', async (t) => {
  const db = new MockDatabase('test.db')
  const adapter = new DatabaseAdapter(db, false)

  const sql = 'select foo from bar'
  const r1 = adapter.tableNames({ sql })

  t.deepEqual(r1, [new QualifiedTablename('main', 'bar')])
})
