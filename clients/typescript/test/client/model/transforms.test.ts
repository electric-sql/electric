import { z } from 'zod'
import test from 'ava'
import {
  _NOT_UNIQUE_,
  _RECORD_NOT_FOUND_,
} from '../../../src/client/validation/errors/messages'
import { schema, Post } from '../generated'
import { transformTableRecord } from '../../../src/client/model/transforms'
import { InvalidRecordTransformationError } from '../../../src/client/validation/errors/invalidRecordTransformationError'
import { DbRecord } from '../../../src/util'
import { sqliteConverter } from '../../../src/client/conversions/sqlite'

const tableName = 'Post'
const fields = schema.getFields(tableName)
const tableDescription = schema.getTableDescription(tableName)
const modelSchema = tableDescription.modelSchema

const post1 = {
  id: 1,
  title: 't1',
  contents: 'c1',
  nbr: 18,
  authorId: 1,
}

test('transformTableRecord should validate the input', (t) => {
  const liftedTransform = (r: DbRecord) =>
    transformTableRecord(
      r,
      (row: Post) => row,
      fields,
      modelSchema,
      sqliteConverter,
      []
    )

  // should not throw for properly typed input
  t.notThrows(() => liftedTransform(post1))

  // should throw for improperly typed input
  t.throws(() => liftedTransform({ ...post1, title: 3 }), {
    instanceOf: z.ZodError,
  })
  t.throws(() => liftedTransform({ ...post1, contents: 3 }), {
    instanceOf: z.ZodError,
  })
  t.throws(() => liftedTransform({ ...post1, nbr: 'string' }), {
    instanceOf: z.ZodError,
  })
})

test('transformTableRecord should validate the output', (t) => {
  const liftedTransform = (r: DbRecord) =>
    transformTableRecord<Post>(
      r,
      // @ts-expect-error: incorrectly typed output
      (row: Post) => ({
        ...row,
        title: 3,
      }),
      fields,
      modelSchema,
      sqliteConverter,
      []
    )
  // should throw for improperly typed input
  t.throws(() => liftedTransform(post1), { instanceOf: z.ZodError })
})

test('transformTableRecord should validate output does not modify immutable fields', (t) => {
  const liftedTransform = (r: DbRecord) =>
    transformTableRecord(
      r,
      (row: Post) => ({
        ...row,
        title: row.title + ' modified',
      }),
      fields,
      modelSchema,
      sqliteConverter,
      ['title']
    )
  t.throws(() => liftedTransform(post1), {
    instanceOf: InvalidRecordTransformationError,
  })
})
