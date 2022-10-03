import test from 'ava'

import { DatabaseAdapter } from '../../src/drivers/expo-sqlite/adapter'
import { MockDatabase } from '../../src/drivers/expo-sqlite/mock'
import { initTestable } from '../../src/drivers/expo-sqlite/test'

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

  db.transaction((tx) => {
    // ...
  })

  t.is(notifier.notifications.length, 1)
})
