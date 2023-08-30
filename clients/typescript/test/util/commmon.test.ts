import test from 'ava'

import { getWaiter } from '../../src/util/common'
import { SatelliteError, SatelliteErrorCode } from '../../src/util/types'

test('test getWaiter onWait resolve', async (t) => {
  const waiter = getWaiter()

  const p = waiter.waitOn()

  waiter.resolve()

  await p

  t.true(waiter.finished())
})

test('test getWaiter onWait reject', async (t) => {
  const waiter = getWaiter()

  const p = waiter.waitOn()

  waiter.reject(new SatelliteError(SatelliteErrorCode.INTERNAL, ''))

  try {
    await p
    t.fail()
  } catch {
    t.true(waiter.finished())
  }
})
