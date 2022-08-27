import test from 'ava'

import { electrify } from '../../src/adapters/cordova-sqlite-storage/index'
import { MockDatabase } from '../../src/adapters/cordova-sqlite-storage/mock'
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
