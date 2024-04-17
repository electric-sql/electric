import test from 'ava'

import { getWaiter, isObject } from '../../src/util/common'
import {
  base64,
  textEncoder,
  textDecoder,
  blobToHexString,
  hexStringToBlob,
} from '../../src/util/encoders'
import { SatelliteError, SatelliteErrorCode } from '../../src/util/types'

const OriginalEncoder = globalThis['TextEncoder']
const OriginalDecoder = globalThis['TextDecoder']

test.afterEach(() => {
  globalThis['TextEncoder'] = OriginalEncoder
  globalThis['TextDecoder'] = OriginalDecoder
})

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

test('test base64 encodes/decodes arbitrary bytestrings', (t) => {
  const originalBytes = new Uint8Array([0, 1, 255, 245, 5, 155])
  const expectedBase64 = 'AAH/9QWb'

  t.deepEqual(base64.fromBytes(originalBytes), expectedBase64)
  t.deepEqual(base64.toBytes(expectedBase64), originalBytes)

  // should also handle empty bytestring
  t.deepEqual(base64.fromBytes(new Uint8Array([])), '')
  t.deepEqual(base64.toBytes(''), new Uint8Array([]))
})

test('test base64 encodes/decodes Unicode characters', (t) => {
  const originalString = 'こんにちは、世界！'
  const expectedBase64 = '44GT44KT44Gr44Gh44Gv44CB5LiW55WM77yB'

  t.is(base64.encode(originalString), expectedBase64)
  t.is(base64.decode(expectedBase64), originalString)
})

test('test textEncoder replacement encodes Unicode characters', (t) => {
  const originalString = 'こんにちは、世界！'

  delete (globalThis as { TextEncoder?: unknown })['TextEncoder']

  const originalEncoded = new OriginalEncoder().encode(originalString)
  const alternativeEncoded = textEncoder.encode(originalString)
  t.deepEqual(originalEncoded, alternativeEncoded)
})

test('test textEncoder replacement decodes Unicode characters', (t) => {
  const originalString = 'こんにちは、世界！'
  const originalEncoded = new OriginalEncoder().encode(originalString)

  delete (globalThis as { TextDecoder?: unknown })['TextDecoder']

  const originalDecoded = new OriginalDecoder().decode(originalEncoded)
  const alternativeDecoded = textDecoder.decode(originalEncoded)
  t.is(alternativeDecoded, originalString)
  t.is(originalDecoded, alternativeDecoded)
})

test('test type encoding/decoding works for arbitrary bytestrings', (t) => {
  const blob = new Uint8Array([0, 1, 255, 245, 5, 155])
  const expectedEncoding = '0001fff5059b'

  t.deepEqual(blobToHexString(blob), expectedEncoding)
  t.deepEqual(hexStringToBlob(expectedEncoding), blob)

  // should also handle empty bytestring
  t.deepEqual(blobToHexString(new Uint8Array([])), '')
  t.deepEqual(hexStringToBlob(''), new Uint8Array([]))
})

test('test isObject detects only objects and not arrays', (t) => {
  t.true(isObject({}))
  t.true(isObject({ field: 'value' }))
  t.false(isObject([]))
  t.false(isObject(new Uint8Array()))
  t.false(isObject(new Int8Array()))
})
