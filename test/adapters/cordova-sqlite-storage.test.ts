import test from 'ava'

import { initTestable } from '../../src/adapters/cordova-sqlite-storage/test'
import { MockSQLitePluginTransaction } from '../../src/adapters/sqlite-plugin/mock'

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
