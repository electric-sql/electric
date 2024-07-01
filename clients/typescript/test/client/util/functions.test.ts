import test from 'ava'
import { equallyTypedObjects } from '../../../src/client/util/functions'

test('equallyTypedObjects returns true if objects are equally typed', (t) => {
  t.assert(equallyTypedObjects({ a: 5, b: 'foo' }, { b: 'bar', a: 9 }))

  t.assert(equallyTypedObjects({}, {}))
})

test('equallyTypedObjects returns false if objects are not equally typed', (t) => {
  t.assert(!equallyTypedObjects({ a: 5, b: 'foo' }, { b: 'bar', a: 9, c: 2 }))

  t.assert(!equallyTypedObjects({ a: 5, b: 'foo', c: 9 }, { b: 'bar', a: 9 }))

  t.assert(!equallyTypedObjects({ a: 5, b: undefined }, { c: undefined, a: 9 }))

  t.assert(!equallyTypedObjects({}, { c: undefined }))
})
