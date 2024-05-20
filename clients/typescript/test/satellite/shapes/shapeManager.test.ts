import test, { ExecutionContext } from 'ava'

import { ShapeManager } from '../../../src/satellite/shapes/shapeManager'
import { sleepAsync } from '../../../src/util'
import { SyncStatus } from '../../../src/client/model/shapes'

test('Shape manager stores the subscription and returns a promise', (t) => {
  // Setup
  const mng = new ShapeManager()

  // Assertions
  const result = mng.syncRequested([{ tablename: 't1' }])
  t.true('key' in result)
  t.true('setServerId' in result)
  t.true('promise' in result)
  t.true((result as any).promise instanceof Promise)
})

test('Shape manager returns an existing promise for already-requested shape', (t) => {
  // Setup
  const mng = new ShapeManager()
  const firstResult = mng.syncRequested([{ tablename: 't1' }])

  // Assertions
  const result = mng.syncRequested([{ tablename: 't1' }])
  t.true('key' in result)
  t.false('setServerId' in result)
  t.true('existing' in result)
  t.is((result as any).existing, (firstResult as any).promise)
  t.is((result as any).key, (firstResult as any).key)
})

test('Shape manager returns a new promise for a shape with a key', (t) => {
  // Setup
  const mng = new ShapeManager()
  const firstResult = mng.syncRequested([{ tablename: 't1' }])

  // Assertions
  const result = mng.syncRequested([{ tablename: 't1' }], 'k1')
  t.true('key' in result)
  t.true('setServerId' in result)
  t.false('existing' in result)
  t.not((result as any).promise, (firstResult as any).promise)
  t.not((result as any).key, (firstResult as any).key)
})

test('Shape manager returns the same promise for the same shape and key', (t) => {
  // Setup
  const mng = new ShapeManager()
  const firstResult = mng.syncRequested([{ tablename: 't1' }], 'k1')

  // Assertions
  const result = mng.syncRequested([{ tablename: 't1' }], 'k1')
  t.true('key' in result)
  t.false('setServerId' in result)
  t.true('existing' in result)
  t.is((result as any).existing, (firstResult as any).promise)
  t.is((result as any).key, (firstResult as any).key)
})

test('Shape manager returns new promise for the same key', (t) => {
  // Setup
  const mng = new ShapeManager()
  const firstResult = mng.syncRequested([{ tablename: 't1' }], 'k1')

  // Assertions
  const result = mng.syncRequested([{ tablename: 't2' }], 'k1')
  t.true('key' in result)
  t.true('setServerId' in result)
  t.false('existing' in result)
  t.not((result as any).promise, (firstResult as any).promise)
  t.is((result as any).key, (firstResult as any).key)
})

test('Shape manager promise gets resolved when data arrives', async (t) => {
  // Setup
  const mng = new ShapeManager()
  const firstResult = mng.syncRequested([{ tablename: 't1' }])
  if ('existing' in firstResult) return void t.fail()
  firstResult.setServerId('testID')

  // Assertions
  const cb = mng.dataDelivered('testID')
  t.deepEqual(cb(), [])

  await promiseResolved(t, firstResult.promise)
})

test('Shape manager promise does not get resolved when data arrives if there are unsubscriptions', async (t) => {
  // Setup
  const mng = new ShapeManager()
  const firstResult = mng.syncRequested([{ tablename: 't1' }], 'k1')
  if ('existing' in firstResult) return void t.fail()
  firstResult.setServerId('testID')
  mng.dataDelivered('testID')()

  const secondResult = mng.syncRequested([{ tablename: 't2' }], 'k1')
  if ('existing' in secondResult) return void t.fail()
  secondResult.setServerId('otherID')

  const cb = mng.dataDelivered('otherID')
  t.deepEqual(cb(), ['testID'])

  await promiseNotResovled(t, secondResult.promise, 10)

  // Making the unsubscribe is not enough
  mng.unsubscribeMade(['testID'])
  await promiseNotResovled(t, secondResult.promise, 10)

  // But receiving the unsub data is
  mng.goneBatchDelivered(['testID'])
  await promiseResolved(t, secondResult.promise)
})

test('Shape manager correctly rehydrates the state', async (t) => {
  // Setup
  const mng = new ShapeManager()
  const firstResult = mng.syncRequested([{ tablename: 't1' }], 'k1')
  if ('existing' in firstResult) return void t.fail()
  firstResult.setServerId('testID')
  mng.dataDelivered('testID')()

  const secondResult = mng.syncRequested([{ tablename: 't2' }], 'k2')
  if ('existing' in secondResult) return void t.fail()
  secondResult.setServerId('id2')
  mng.dataDelivered('id2')()

  mng.unsubscribeMade(['testID'])
  mng.goneBatchDelivered(['testID'])

  // Simulate reconnect
  mng.initialize(mng.serialize())
  t.deepEqual(mng.listContinuedSubscriptions(), ['id2'])
})

test('Shape manager notifies about shape sync status lifecycle', async (t) => {
  // Setup
  const syncStatusUpdates: { key: string; status: SyncStatus }[] = []
  const subKey = 'foo'
  const serverId1 = 'testID'
  const serverId2 = 'testID2'
  const mng = new ShapeManager((key, status) =>
    syncStatusUpdates.push({ key, status })
  )

  // Assertions

  // request shape sub
  const firstResult = mng.syncRequested([{ tablename: 't1' }], subKey)
  t.is(syncStatusUpdates.length, 0)
  if ('existing' in firstResult) return void t.fail()
  firstResult.setServerId(serverId1)
  t.is(syncStatusUpdates.length, 1)
  t.deepEqual(syncStatusUpdates[0], {
    key: subKey,
    status: {
      status: 'establishing',
      progress: 'receiving_data',
      serverId: serverId1,
    },
  })

  // notify when shape data delivered
  const cb = mng.dataDelivered(serverId1)
  t.deepEqual(cb(), [])
  t.is(syncStatusUpdates.length, 2)
  t.deepEqual(syncStatusUpdates[1], {
    key: subKey,
    status: {
      status: 'active',
      serverId: serverId1,
    },
  })

  // request overshadowing shape for same key
  const secondResult = mng.syncRequested([{ tablename: 't2' }], subKey)
  if ('existing' in secondResult) return void t.fail()
  secondResult.setServerId(serverId2)
  t.is(syncStatusUpdates.length, 3)
  t.deepEqual(syncStatusUpdates[2], {
    key: subKey,
    status: {
      status: 'establishing',
      progress: 'receiving_data',
      serverId: serverId2,
      oldServerId: serverId1,
    },
  })

  // notify when new shape data delivered once unsubscribe
  // of previous shape is made
  const cb2 = mng.dataDelivered(serverId2)
  t.deepEqual(cb2(), [serverId1])
  t.is(syncStatusUpdates.length, 3)
  mng.unsubscribeMade([serverId1])
  t.is(syncStatusUpdates.length, 4)
  t.deepEqual(syncStatusUpdates[3], {
    key: subKey,
    status: {
      status: 'establishing',
      progress: 'removing_data',
      serverId: serverId2,
    },
  })

  // notify when new shape is both delivered and old one cleaned up
  mng.goneBatchDelivered([serverId1])
  t.is(syncStatusUpdates.length, 5)
  t.deepEqual(syncStatusUpdates[4], {
    key: subKey,
    status: {
      status: 'active',
      serverId: serverId2,
    },
  })

  // notify when shape is being cancelled
  mng.unsubscribeMade([serverId2])
  t.is(syncStatusUpdates.length, 6)
  t.deepEqual(syncStatusUpdates[5], {
    key: subKey,
    status: {
      status: 'cancelling',
      serverId: serverId2,
    },
  })

  // notify when shape is completely gone
  mng.goneBatchDelivered([serverId2])
  t.is(syncStatusUpdates.length, 7)
  t.deepEqual(syncStatusUpdates[6], {
    key: subKey,
    status: undefined,
  })
})

async function promiseResolved(
  t: ExecutionContext<any>,
  promise: Promise<any>,
  ms: number = 10
) {
  t.timeout(ms)
  await t.notThrowsAsync(() => promise)
}

async function promiseNotResovled(
  t: ExecutionContext<any>,
  promise: Promise<any>,
  ms: number = 10
) {
  await t.throwsAsync(
    () =>
      Promise.race([
        sleepAsync(ms).then(() => {
          throw new Error('Timeout reached')
        }),
        promise,
      ]),
    { message: 'Timeout reached' }
  )
}
