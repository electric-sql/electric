import test from 'ava'

import Database from 'better-sqlite3'

import { electrify } from '../../dist/adapters/better-sqlite3'
import { MockDatabase } from '../../dist/adapters/better-sqlite3/mock'
import { MockNotifier } from '../../dist/notifiers/mock'

test('electrify returns an equivalent database client', t => {
  const original = new Database('test.db')
  const db = electrify(original)

  const originalKeys = Object.getOwnPropertyNames(original)
  const originalPrototype = Object.getPrototypeOf(original)
  const allKeys = originalKeys.concat(Object.keys(originalPrototype))
  allKeys.forEach((key) => {
    t.assert(key in db)
  })
})

test('electrify does not remove non-patched properties and methods', t => {
  const original = new Database('test.db')
  const electric = electrify(original)

  t.is(typeof electric.pragma, 'function')
})

test('the electrified database has `.electric.notifyCommit()`', t => {
  const original = new Database('test.db')

  const notifier = new MockNotifier(original.name)
  t.is(notifier.notifications.length, 0)

  const db = electrify(original, notifier)
  db.electric.notifyCommit()

  t.is(db.electric, notifier)
  t.is(notifier.notifications.length, 1)
})

test('exec\'ing a dangerous statement calls notifyCommit', t => {
  const original = new MockDatabase('test.db')

  const notifier = new MockNotifier(original.name)
  t.is(notifier.notifications.length, 0)

  const db = electrify(original, notifier)
  db.exec('insert into items')

  t.is(notifier.notifications.length, 1)
})

test('exec\'ing a non dangerous statement doesn\'t call notifyCommit', t => {
  const original = new MockDatabase('test.db')

  const notifier = new MockNotifier(original.name)
  t.is(notifier.notifications.length, 0)

  const db = electrify(original, notifier)
  db.exec('select 1')

  t.is(notifier.notifications.length, 0)
})

test('running a transaction function calls notifyCommit', t => {
  const original = new Database('test.db')

  const notifier = new MockNotifier(original.name)
  t.is(notifier.notifications.length, 0)

  const db = electrify(original, notifier)
  const runTx = db.transaction(() => {})
  runTx()

  t.is(notifier.notifications.length, 1)
})

test('running a transaction sub function calls notifyCommit', t => {
  const original = new Database('test.db')
  const notifier = new MockNotifier(original.name)
  const db = electrify(original, notifier)

  const a = db.transaction(() => {})
  const b = db.transaction(() => {})
  const c = db.transaction(() => {})

  t.is(notifier.notifications.length, 0)

  a.deferred()
  t.is(notifier.notifications.length, 1)

  b.immediate()
  t.is(notifier.notifications.length, 2)

  c.exclusive()
  t.is(notifier.notifications.length, 3)
})

test('electrify preserves chainability', t => {
  const original = new MockDatabase('test.db')
  const notifier = new MockNotifier(original.name)
  const db = electrify(original, notifier)

  t.is(notifier.notifications.length, 0)

  db.exec('insert into items')
    .exec('update items')
    .exec('drop items')

  t.is(notifier.notifications.length, 3)
})

test('running a prepared statement outside of a transaction notifies', t => {
  const original = new MockDatabase('test.db')
  const notifier = new MockNotifier(original.name)
  const db = electrify(original, notifier)

  t.is(notifier.notifications.length, 0)

  const stmt = db.prepare('insert into items')
  stmt.run()

  t.is(notifier.notifications.length, 1)
})

test('running a prepared statement *inside* of a transaction does *not* notify', t => {
  const original = new MockDatabase('test.db')
  const notifier = new MockNotifier(original.name)
  const db = electrify(original, notifier)

  t.is(notifier.notifications.length, 0)

  const stmt = db.prepare('insert into items')
  const runTx = db.transaction(() => {
    stmt.run()
  })
  runTx()

  // The transaaction notifies, so we're testing it's only
  // notification not two!
  t.is(notifier.notifications.length, 1)
})

test('iterating a prepared statement works', t => {
  const original = new MockDatabase('test.db')
  const notifier = new MockNotifier(original.name)
  const db = electrify(original, notifier)

  t.is(notifier.notifications.length, 0)

  const stmt = db.prepare('insert into items')
  const results = [...stmt.iterate()]

  t.is(notifier.notifications.length, 1)
})

