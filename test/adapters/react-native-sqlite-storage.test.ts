import test from 'ava'

import { electrify } from '../../dist/adapters/react-native-sqlite-storage/index'
import { MockDatabase, MockTransaction } from '../../dist/adapters/react-native-sqlite-storage/mock'
import { MockNotifier } from '../../dist/notifiers/mock'

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

  const tx = new MockTransaction()
  db.addTransaction(tx)

  t.is(notifier.notifications.length, 1)
})

test('running a read only transaction does not notifyCommit', t => {
  const original = new MockDatabase('test.db')
  const notifier = new MockNotifier(original.dbName)
  const db = electrify(original, notifier)

  t.is(notifier.notifications.length, 0)

  const tx = new MockTransaction(true)
  db.addTransaction(tx)

  t.is(notifier.notifications.length, 0)
})

test('attaching a database now notifies for both', t => {
  const original = new MockDatabase('test.db')
  const notifier = new MockNotifier(original.dbName)
  const db = electrify(original, notifier)

  t.is(notifier.notifications.length, 0)

  db.attach('lala.db', 'lala')
  db.addTransaction(new MockTransaction())

  t.is(notifier.notifications.length, 2)
})

test('detaching a database notifies for one less', t => {
  const original = new MockDatabase('test.db')
  const notifier = new MockNotifier(original.dbName)
  const db = electrify(original, notifier)

  t.is(notifier.notifications.length, 0)

  db.attach('lala.db', 'lala')
  db.addTransaction(new MockTransaction())

  t.is(notifier.notifications.length, 2)

  db.detatch('lala')
  db.addTransaction(new MockTransaction())

  t.is(notifier.notifications.length, 3)
})
