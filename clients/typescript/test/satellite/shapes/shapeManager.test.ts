import test, { ExecutionContext } from 'ava'

import { ShapeManager } from '../../../src/satellite/shapes/shapeManager'
import { sleepAsync } from '../../../src/util'

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
