import test from 'ava'

import { initTestable } from '../../src/adapters/react-native-sqlite-storage/test'
import { MockDatabase } from '../../src/adapters/react-native-sqlite-storage/mock'
import { QueryAdapter } from '../../src/adapters/react-native-sqlite-storage/query'
import { SatelliteClient } from '../../src/adapters/react-native-sqlite-storage/satellite'
import { MockSQLitePluginTransaction } from '../../src/adapters/sqlite-plugin/mock'
import { QualifiedTablename } from '../../src/util/tablename'

test('electrify returns an equivalent database client', async t => {
  const [original, _notifier, db] = await initTestable('test.db')

  const originalKeys = Object.getOwnPropertyNames(original)
  const originalPrototype = Object.getPrototypeOf(original)
  const allKeys = originalKeys.concat(Object.keys(originalPrototype))

  allKeys.forEach((key) => {
    t.assert(key in db)
  })
})

test('running a transaction runs notifyCommit', async t => {
  const [original, notifier, db] = await initTestable('test.db')

  t.is(notifier.notifications.length, 0)

  const tx = new MockSQLitePluginTransaction()
  db.addTransaction(tx)

  t.is(notifier.notifications.length, 1)
})

test('running a read only transaction does not notifyCommit', async t => {
  const [original, notifier, db] = await initTestable('test.db')

  t.is(notifier.notifications.length, 0)

  const tx = new MockSQLitePluginTransaction(true)
  db.addTransaction(tx)

  t.is(notifier.notifications.length, 0)
})

test('attaching a database now notifies for both', async t => {
  const [original, notifier, db] = await initTestable('test.db')

  t.is(notifier.notifications.length, 0)

  db.attach('lala.db', 'lala')
  db.addTransaction(new MockSQLitePluginTransaction())

  t.is(notifier.notifications.length, 2)
})

test('detaching a database notifies for one less', async t => {
  const [original, notifier, db] = await initTestable('test.db')

  t.is(notifier.notifications.length, 0)

  db.attach('lala.db', 'lala')
  db.addTransaction(new MockSQLitePluginTransaction())

  t.is(notifier.notifications.length, 2)

  db.detach('lala')
  db.addTransaction(new MockSQLitePluginTransaction())

  t.is(notifier.notifications.length, 3)
})

test('enablePromiseRuntime(mockDb) works', async t => {
  const [original, notifier, db] = await initTestable('test.db', {
    enablePromises: true
  })

  t.is(notifier.dbNames.size, 1)

  return original.attach('lala.db', 'lala')
    .then((arg) => {
      t.is(arg, 'mocked!')
    })
})

test('working with the promise runtime works', async t => {
  const [original, notifier, db] = await initTestable('test.db', {
    enablePromises: true
  })

  t.is(notifier.notifications.length, 0)

  return db
    .attach('lala.db', 'lala')
    .then(() => {
      const tx = new MockSQLitePluginTransaction()
      db.addTransaction(tx)

      t.is(notifier.notifications.length, 2)
    })
})

test('query adapter perform works', async t => {
  const db = new MockDatabase('test.db')
  const adapter = new QueryAdapter(db, 'main')

  const r1 = await adapter.perform('select 1')
  const r2 = await adapter.perform('select ?', [1])

  t.deepEqual([r1, r2], [[{i: 0}], [{i: 0}]])
})

test('query adapter tableNames works', async t => {
  const db = new MockDatabase('test.db')
  const adapter = new QueryAdapter(db, 'main')

  const sql = 'select foo from bar'
  const r1 = await adapter.tableNames(sql)

  t.deepEqual(r1, [new QualifiedTablename('main', 'bar')])
})

test('satellite client exec works', async t => {
  const db = new MockDatabase('test.db')
  const client = new SatelliteClient(db)

  const result = await client.exec('drop badgers')

  t.is(result, undefined)
})

test('satellite client query works', async t => {
  const db = new MockDatabase('test.db')
  const client = new SatelliteClient(db)

  const result = await client.query('select foo from bars')

  t.deepEqual(result, [{i: 0}])
})
