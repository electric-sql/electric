import test from 'ava'
import { validateRecordTransformation } from '../../../src/client/validation/validation'
import { InvalidRecordTransformationError } from '../../../src/client/validation/errors/invalidRecordTransformationError'

test('validateRecordTransformation does not throw if immutable fields not changed', (t) => {
  const originalRecord = {
    id: 1,
    name: 'test',
    potato: 'banana',
    data: new Uint8Array([1, 2]),
    whatever: 'foo',
  }

  const transformedRecord = {
    id: 1,
    name: 'test-other',
    potato: 'banana',
    data: new Uint8Array([1, 2]),
    whatever: 'foobar',
  }

  const immutableFields = ['id', 'potato']
  let result
  t.notThrows(() => {
    result = validateRecordTransformation(
      originalRecord,
      transformedRecord,
      immutableFields
    )
  })
  t.deepEqual(result, transformedRecord)
})

test('validateRecordTransformation throws if immutable fields changed', (t) => {
  const originalRecord = {
    id: 1,
    name: 'test',
    potato: 'banana',
    data: new Uint8Array([1, 2]),
    whatever: 'foo',
  }

  const transformedRecord = {
    id: 2,
    name: 'test-other',
    potato: 'banana',
    data: new Uint8Array([1, 2, 3]),
    whatever: 'foobar',
  }

  const immutableFields = ['id', 'data']

  t.throws(
    () => {
      validateRecordTransformation(
        originalRecord,
        transformedRecord,
        immutableFields
      )
    },
    {
      instanceOf: InvalidRecordTransformationError,
      message: 'Record transformation modified immutable fields: id, data',
    }
  )
})
