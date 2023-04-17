import test from 'ava'

import { initTestable } from '../../src/drivers/expo-sqlite/test'

test('electrify returns an equivalent database client', async (t) => {
  const [original, _notifier, db] = await initTestable('test.db')

  const originalKeys = Object.getOwnPropertyNames(original)
  const originalPrototype = Object.getPrototypeOf(original)
  const allKeys = originalKeys.concat(Object.keys(originalPrototype))

  allKeys.forEach((key) => {
    t.assert(key in db)
  })
})

test('running a transaction runs potentiallyChanged', async (t) => {
  const [_original, notifier, db] = await initTestable('test.db')

  t.is(notifier.notifications.length, 0)

  db.transaction((_tx) => {
    // ...
  })

  t.is(notifier.notifications.length, 1)
})

test('running a readTransaction does not notify', async (t) => {
  const [_original, notifier, db] = await initTestable('test.db')

  t.is(notifier.notifications.length, 0)

  db.readTransaction((_tx) => {
    // ...
  })

  t.is(notifier.notifications.length, 0)
})

test('exec notifies when readOnly is false', async (t) => {
  const [_original, notifier, db] = await initTestable('test.db', true)

  t.is(notifier.notifications.length, 0)

  db.exec([{ sql: 'drop lalas', args: [] }], false, () => {})

  t.is(notifier.notifications.length, 1)
})

test('exec does not notify when readOnly', async (t) => {
  const [_original, notifier, db] = await initTestable('test.db', true)

  t.is(notifier.notifications.length, 0)

  db.exec([{ sql: 'select 1', args: [] }], true, () => {})

  t.is(notifier.notifications.length, 0)
})
