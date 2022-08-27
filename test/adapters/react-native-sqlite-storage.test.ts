import test from 'ava'

import { electrify } from '../../src/adapters/react-native-sqlite-storage/index'
import { MockDatabase, enablePromiseRuntime } from '../../src/adapters/react-native-sqlite-storage/mock'
import { MockSQLitePluginTransaction } from '../../src/adapters/sqlite-plugin/mock'
import { MockNotifier } from '../../src/notifiers/mock'

test('electrify returns an equivalent database client', t => {
  const original = new MockDatabase('test.db')
  const db = electrify(original)

  const originalKeys = Object.getOwnPropertyNames(original)
  const originalPrototype = Object.getPrototypeOf(original)
  const allKeys = originalKeys.concat(Object.keys(originalPrototype))

  allKeys.forEach((key) => {
    t.assert(key in db)
  })
})

test('running a transaction runs notifyCommit', t => {
  const original = new MockDatabase('test.db')
  const notifier = new MockNotifier(original.dbName)
  const db = electrify(original, notifier)

  t.is(notifier.notifications.length, 0)

  const tx = new MockSQLitePluginTransaction()
  db.addTransaction(tx)

  t.is(notifier.notifications.length, 1)
})

test('running a read only transaction does not notifyCommit', t => {
  const original = new MockDatabase('test.db')
  const notifier = new MockNotifier(original.dbName)
  const db = electrify(original, notifier)

  t.is(notifier.notifications.length, 0)

  const tx = new MockSQLitePluginTransaction(true)
  db.addTransaction(tx)

  t.is(notifier.notifications.length, 0)
})

test('attaching a database now notifies for both', t => {
  const original = new MockDatabase('test.db')
  const notifier = new MockNotifier(original.dbName)
  const db = electrify(original, notifier)

  t.is(notifier.notifications.length, 0)

  db.attach('lala.db', 'lala')
  db.addTransaction(new MockSQLitePluginTransaction())

  t.is(notifier.notifications.length, 2)
})

test('detaching a database notifies for one less', t => {
  const original = new MockDatabase('test.db')
  const notifier = new MockNotifier(original.dbName)
  const db = electrify(original, notifier)

  t.is(notifier.notifications.length, 0)

  db.attach('lala.db', 'lala')
  db.addTransaction(new MockSQLitePluginTransaction())

  t.is(notifier.notifications.length, 2)

  db.detach('lala')
  db.addTransaction(new MockSQLitePluginTransaction())

  t.is(notifier.notifications.length, 3)
})

test('enablePromiseRuntime(mockDb) works', t => {
  const mockDb = new MockDatabase('test.db')
  const original = enablePromiseRuntime(mockDb)
  const notifier = new MockNotifier(original.dbName)
  const db = electrify(original, notifier)

  t.is(notifier.dbNames.size, 1)

  return original.attach('lala.db', 'lala')
    .then((arg) => {
      t.is(arg, 'mocked!')
    })
})

test('working with the promise runtime works', t => {
  const mockDb = new MockDatabase('test.db')
  const original = enablePromiseRuntime(mockDb)
  const notifier = new MockNotifier(original.dbName)
  const db = electrify(original, notifier)

  t.is(notifier.notifications.length, 0)

  const promise = db.attach('lala.db', 'lala')
    .then(() => {
      const tx = new MockSQLitePluginTransaction()
      db.addTransaction(tx)

      t.is(notifier.notifications.length, 2)
    })

  return promise
})
