import test from 'ava'

import { MockDatabase } from '../../src/drivers/expo-sqlite/mock'
import { DatabaseAdapter } from '../../src/drivers/expo-sqlite'
import { QualifiedTablename } from '../../src/util'

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

test('database adapter tableNames works', async (t) => {
  const db = new MockDatabase('test.db')
  const adapter = new DatabaseAdapter(db)

  const sql = 'select foo from bar'
  const r1 = adapter.tableNames({ sql })

  t.deepEqual(r1, [new QualifiedTablename('main', 'bar')])
})

// TODO: move the unit tests below to the unit tests of the DAL because they test notifications
/*
test('running a transaction runs potentiallyChanged', async (t) => {
  const [_original, notifier, db] = await initTestable('test.db')

  t.is(notifier.notifications.length, 0)

  db.transaction((_tx) => {
    // ...
  })

  t.is(notifier.notifications.length, 1)
})

test('running a readTransaction does not notify', async (t) => {
  const [_original, notifier, db] = await initTestable('test.db')

  t.is(notifier.notifications.length, 0)

  db.readTransaction((_tx) => {
    // ...
  })

  t.is(notifier.notifications.length, 0)
})

test('exec notifies when readOnly is false', async (t) => {
  const [_original, notifier, db] = await initTestable('test.db', true)

  t.is(notifier.notifications.length, 0)

  db.exec([{ sql: 'drop lalas', args: [] }], false, () => {})

  t.is(notifier.notifications.length, 1)
})

test('exec does not notify when readOnly', async (t) => {
  const [_original, notifier, db] = await initTestable('test.db', true)

  t.is(notifier.notifications.length, 0)

  db.exec([{ sql: 'select 1', args: [] }], true, () => {})

  t.is(notifier.notifications.length, 0)
})
*/
