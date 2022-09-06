import test from 'ava'

import Database from 'better-sqlite3'

import { electrify } from '../../src/drivers/better-sqlite3/index'
import { MockDatabase } from '../../src/drivers/better-sqlite3/mock'
import { QueryAdapter } from '../../src/drivers/better-sqlite3/query'
import { SatelliteDatabaseAdapter } from '../../src/drivers/better-sqlite3/satellite'
import { MockCommitNotifier } from '../../src/notifiers/mock'
import { QualifiedTablename } from '../../src/util/tablename'

test('electrify returns an equivalent database client', async t => {
  const original = new Database('test.db')
  const db = await electrify(original)

  const originalKeys = Object.getOwnPropertyNames(original)
  const originalPrototype = Object.getPrototypeOf(original)
  const allKeys = originalKeys.concat(Object.keys(originalPrototype))
  allKeys.forEach((key) => {
    t.assert(key in db)
  })
})

test('electrify does not remove non-patched properties and methods', async t => {
  const original = new Database('test.db')
  const electric = await electrify(original)

  t.is(typeof electric.pragma, 'function')
})

test('the electrified database has `.electric.notifyCommit()`', async t => {
  const original = new Database('test.db')

  const notifier = new MockCommitNotifier(original.name)
  t.is(notifier.notifications.length, 0)

  const db = await electrify(original, {commitNotifier: notifier})
  db.electric.notifyCommit()

  t.is(notifier.notifications.length, 1)
})

test('exec\'ing a dangerous statement calls notifyCommit', async t => {
  const original = new MockDatabase('test.db')

  const notifier = new MockCommitNotifier(original.name)
  t.is(notifier.notifications.length, 0)

  const db = await electrify(original, {commitNotifier: notifier})
  db.exec('insert into items')

  t.is(notifier.notifications.length, 1)
})

test('exec\'ing a non dangerous statement doesn\'t call notifyCommit', async t => {
  const original = new MockDatabase('test.db')

  const notifier = new MockCommitNotifier(original.name)
  t.is(notifier.notifications.length, 0)

  const db = await electrify(original, {commitNotifier: notifier})
  db.exec('select 1')

  t.is(notifier.notifications.length, 0)
})

test('running a transaction function calls notifyCommit', async t => {
  const original = new Database('test.db')

  const notifier = new MockCommitNotifier(original.name)
  t.is(notifier.notifications.length, 0)

  const db = await electrify(original, {commitNotifier: notifier})
  const runTx = db.transaction(() => {})
  runTx()

  t.is(notifier.notifications.length, 1)
})

test('running a transaction sub function calls notifyCommit', async t => {
  const original = new Database('test.db')
  const notifier = new MockCommitNotifier(original.name)
  const db = await electrify(original, {commitNotifier: notifier})

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

test('electrify preserves chainability', async t => {
  const original = new MockDatabase('test.db')
  const notifier = new MockCommitNotifier(original.name)
  const db = await electrify(original, {commitNotifier: notifier})

  t.is(notifier.notifications.length, 0)

  db.exec('insert into items')
    .exec('update items')
    .exec('drop items')

  t.is(notifier.notifications.length, 3)
})

test('running a prepared statement outside of a transaction notifies', async t => {
  const original = new MockDatabase('test.db')
  const notifier = new MockCommitNotifier(original.name)
  const db = await electrify(original, {commitNotifier: notifier})

  t.is(notifier.notifications.length, 0)

  const stmt = db.prepare('insert into items')
  stmt.run()

  t.is(notifier.notifications.length, 1)
})

test('running a prepared statement *inside* of a transaction does *not* notify', async t => {
  const original = new MockDatabase('test.db')
  const notifier = new MockCommitNotifier(original.name)
  const db = await electrify(original, {commitNotifier: notifier})

  t.is(notifier.notifications.length, 0)

  const stmt = db.prepare('insert into items')
  const runTx = db.transaction(() => {
    stmt.run()
  })
  runTx()

  // The transaction notifies, so we're testing it's only
  // one notification not two!
  t.is(notifier.notifications.length, 1)
})

test('iterating a prepared statement works', async t => {
  const original = new MockDatabase('test.db')
  const notifier = new MockCommitNotifier(original.name)
  const db = await electrify(original, {commitNotifier: notifier})

  t.is(notifier.notifications.length, 0)

  const stmt = db.prepare('insert into items')
  const results = [...stmt.iterate()]

  t.is(notifier.notifications.length, 1)
})

test('query adapter perform works', async t => {
  const db = new MockDatabase('test.db')
  const adapter = new QueryAdapter(db, 'main')

  const r1 = await adapter.perform('select 1')
  const r2 = await adapter.perform('select ?', [1])

  const stmt = db.prepare('select ?')
  const r3 = await adapter.perform(stmt, [2])

  t.deepEqual([r1, r2, r3], [[], [], []])
})

test('query adapter tableNames works', async t => {
  const db = new MockDatabase('test.db')
  const adapter = new QueryAdapter(db, 'main')

  const sql = 'select foo from bar'
  const r1 = await adapter.tableNames(sql)
  const r2 = await adapter.tableNames(db.prepare(sql))

  t.deepEqual(r1, r2)
  t.deepEqual(r2, [new QualifiedTablename('main', 'bar')])
})

test('satellite client exec works', async t => {
  const db = new MockDatabase('test.db')
  const adapter = new SatelliteDatabaseAdapter(db)

  const result = await adapter.exec('drop badgers')

  t.is(result, undefined)
})

test('satellite client query works', async t => {
  const db = new MockDatabase('test.db')
  const adapter = new SatelliteDatabaseAdapter(db)

  const result = await adapter.query('select foo from bars')

  t.deepEqual(result, [])
})
