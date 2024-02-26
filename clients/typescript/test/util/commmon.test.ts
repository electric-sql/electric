import test from 'ava'

import { getWaiter, base64 } from '../../src/util/common'
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

test('test base64 encodes/decodes string', (t) => {
  const originalString = 'Hello, World!'
  const expectedBase64 = 'SGVsbG8sIFdvcmxkIQ=='

  t.is(base64.encode(originalString), expectedBase64)
  t.is(base64.decode(expectedBase64), originalString)
})

test('test base64 encodes/decodes empty string', (t) => {
  const originalString = ''
  const expectedBase64 = ''

  t.is(base64.encode(originalString), expectedBase64)
  t.is(base64.decode(expectedBase64), originalString)
})

test('test base64 encodes/decodes special characters', (t) => {
  const originalString = '🚀🌟🌈'
  const expectedBase64 = '8J+agPCfjJ/wn4yI'

  t.is(base64.encode(originalString), expectedBase64)
  t.is(base64.decode(expectedBase64), originalString)
})

test('test base64 encodes/decodes Unicode characters', (t) => {
  const originalString = 'こんにちは、世界！'
  const expectedBase64 = '44GT44KT44Gr44Gh44Gv44CB5LiW55WM77yB'

  t.is(base64.encode(originalString), expectedBase64)
  t.is(base64.decode(expectedBase64), originalString)
})
