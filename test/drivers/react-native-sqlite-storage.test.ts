import test from 'ava'

import { DatabaseAdapter } from '../../src/drivers/react-native-sqlite-storage/adapter'
import { MockDatabase } from '../../src/drivers/react-native-sqlite-storage/mock'
import { initTestable } from '../../src/drivers/react-native-sqlite-storage/test'
import { MockSQLitePluginTransaction } from '../../src/drivers/sqlite-plugin/mock'
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

test.only('running a transaction runs potentiallyChanged', async t => {
  const [original, notifier, db] = await initTestable('test.db')

  t.is(notifier.notifications.length, 0)

  const tx = new MockSQLitePluginTransaction()
  db.transaction((tx) => {
    tx.executeSql('insert foo into bar')
  })

  t.is(notifier.notifications.length, 1)
})

test('adding a transaction runs potentiallyChanged', async t => {
  const [original, notifier, db] = await initTestable('test.db')

  t.is(notifier.notifications.length, 0)

  const tx = new MockSQLitePluginTransaction()
  db.addTransaction(tx)

  t.is(notifier.notifications.length, 1)
})

test('adding a read only transaction does not potentiallyChanged', async t => {
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

test('database adapter run works', async t => {
  const db = new MockDatabase('test.db')
  const adapter = new DatabaseAdapter(db)

  const result = await adapter.run('drop badgers')

  t.is(result, undefined)
})

test('database adapter query works', async t => {
  const db = new MockDatabase('test.db')
  const adapter = new DatabaseAdapter(db)

  const result = await adapter.query('select foo from bars')

  t.deepEqual(result, [{i: 0}])
})

test('database adapter tableNames works', async t => {
  const db = new MockDatabase('test.db')
  const adapter = new DatabaseAdapter(db)

  const sql = 'select foo from bar'
  const r1 = adapter.tableNames(sql)

  t.deepEqual(r1, [new QualifiedTablename('main', 'bar')])
})
