import test from 'ava'

import Database from 'better-sqlite3'

import { DatabaseAdapter } from '../../src/drivers/better-sqlite3/adapter'
import { electrify } from '../../src/drivers/better-sqlite3/index'
import { MockDatabase } from '../../src/drivers/better-sqlite3/mock'
import { MockNotifier } from '../../src/notifiers/mock'
import { MockRegistry } from '../../src/satellite/mock'
import { QualifiedTablename } from '../../src/util/tablename'

test('electrify returns an equivalent database client', async t => {
  const original = new Database('test.db')
  const registry = new MockRegistry()
  const db = await electrify(original, {registry: registry})

  const originalKeys = Object.getOwnPropertyNames(original)
  const originalPrototype = Object.getPrototypeOf(original)
  const allKeys = originalKeys.concat(Object.keys(originalPrototype))
  allKeys.forEach((key) => {
    t.assert(key in db)
  })
})

test('electrify does not remove non-patched properties and methods', async t => {
  const original = new Database('test.db')
  const registry = new MockRegistry()
  const db = await electrify(original, {registry: registry})

  t.is(typeof db.pragma, 'function')
})

test('the electrified database has `.electric.potentiallyChanged()`', async t => {
  const original = new Database('test.db')
  const notifier = new MockNotifier(original.name)
  const registry = new MockRegistry()
  const db = await electrify(original, {notifier: notifier, registry: registry})

  t.is(notifier.notifications.length, 0)

  db.electric.potentiallyChanged()

  t.is(notifier.notifications.length, 1)
})

test('exec\'ing a dangerous statement calls potentiallyChanged', async t => {
  const original = new MockDatabase('test.db')
  const notifier = new MockNotifier(original.name)
  const registry = new MockRegistry()
  const db = await electrify(original, {notifier: notifier, registry: registry})

  t.is(notifier.notifications.length, 0)

  db.exec('insert into parent')

  t.is(notifier.notifications.length, 1)
})

test('exec\'ing a non dangerous statement doesn\'t call potentiallyChanged', async t => {
  const original = new MockDatabase('test.db')
  const notifier = new MockNotifier(original.name)
  const registry = new MockRegistry()
  const db = await electrify(original, {notifier: notifier, registry: registry})

  t.is(notifier.notifications.length, 0)

  db.exec('select 1')

  t.is(notifier.notifications.length, 0)
})

test('running a transaction function calls potentiallyChanged', async t => {
  const original = new MockDatabase('test.db')
  const notifier = new MockNotifier(original.name)
  const registry = new MockRegistry()
  const db = await electrify(original, {notifier: notifier, registry: registry})

  t.is(notifier.notifications.length, 0)

  const runTx = db.transaction(() => {})
  runTx()

  t.is(notifier.notifications.length, 1)
})

test('running a transaction sub function calls potentiallyChanged', async t => {
  const original = new MockDatabase('test.db')
  const notifier = new MockNotifier(original.name)
  const registry = new MockRegistry()
  const db = await electrify(original, {notifier: notifier, registry: registry})

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
  const notifier = new MockNotifier(original.name)
  const registry = new MockRegistry()
  const db = await electrify(original, {notifier: notifier, registry: registry})

  t.is(notifier.notifications.length, 0)

  db.exec('insert into parent')
    .exec('update parent')
    .exec('drop parent')

  t.is(notifier.notifications.length, 3)
})

test('running a prepared statement outside of a transaction notifies', async t => {
  const original = new MockDatabase('test.db')
  const notifier = new MockNotifier(original.name)
  const registry = new MockRegistry()
  const db = await electrify(original, {notifier: notifier, registry: registry})

  t.is(notifier.notifications.length, 0)

  const stmt = db.prepare('insert into parent')
  stmt.run()

  t.is(notifier.notifications.length, 1)
})

test('running a prepared statement *inside* of a transaction does *not* notify', async t => {
  const original = new MockDatabase('test.db')
  const notifier = new MockNotifier(original.name)
  const registry = new MockRegistry()
  const db = await electrify(original, {notifier: notifier, registry: registry})

  t.is(notifier.notifications.length, 0)

  const stmt = db.prepare('insert into parent')
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
  const notifier = new MockNotifier(original.name)
  const registry = new MockRegistry()
  const db = await electrify(original, {notifier: notifier, registry: registry})

  t.is(notifier.notifications.length, 0)

  const stmt = db.prepare('insert into parent')
  const results = [...stmt.iterate()]

  t.is(notifier.notifications.length, 1)
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

  t.deepEqual(result, [{foo: 'bar'}, {foo: 'baz'}])
})

test('database adapter tableNames works', async t => {
  const db = new MockDatabase('test.db')
  const adapter = new DatabaseAdapter(db)

  const sql = 'select foo from bar'
  const r1 = adapter.tableNames(sql)
  const r2 = adapter.tableNames(db.prepare(sql))

  t.deepEqual(r1, r2)
  t.deepEqual(r2, [new QualifiedTablename('main', 'bar')])
})
