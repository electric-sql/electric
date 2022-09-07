import test from 'ava'

import { initTestable } from '../../src/drivers/cordova-sqlite-storage/test'
import { MockDatabase } from '../../src/drivers/cordova-sqlite-storage/mock'
import { QueryAdapter } from '../../src/drivers/cordova-sqlite-storage/query'
import { SatelliteDatabaseAdapter } from '../../src/drivers/cordova-sqlite-storage/satellite'
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

test('running a transaction runs potentiallyChanged', async t => {
  const [original, notifier, db] = await initTestable('test.db')

  t.is(notifier.notifications.length, 0)

  const tx = new MockSQLitePluginTransaction()
  db.addTransaction(tx)

  t.is(notifier.notifications.length, 1)
})

test('running a read only transaction does not potentiallyChanged', async t => {
  const [original, notifier, db] = await initTestable('test.db')

  t.is(notifier.notifications.length, 0)

  const tx = new MockSQLitePluginTransaction(true)
  db.addTransaction(tx)

  t.is(notifier.notifications.length, 0)
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
  const adapter = new SatelliteDatabaseAdapter(db)

  const result = await adapter.exec('drop badgers')

  t.is(result, undefined)
})

test('satellite client query works', async t => {
  const db = new MockDatabase('test.db')
  const adapter = new SatelliteDatabaseAdapter(db)

  const result = await adapter.query('select foo from bars')

  t.deepEqual(result, [{i: 0}])
})
