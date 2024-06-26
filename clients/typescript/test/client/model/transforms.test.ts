import test from 'ava'
import { schema } from '../generated'
import {
  setReplicationTransform,
  transformTableRecord,
} from '../../../src/client/model/transforms'
import { InvalidRecordTransformationError } from '../../../src/client/validation/errors/invalidRecordTransformationError'
import { DbRecord, QualifiedTablename } from '../../../src/util'
import { sqliteConverter } from '../../../src/client/conversions/sqlite'

const tableName = 'Post'
const fields = schema.getFields(tableName)

type Post = {
  id: number
  title: string
  contents: string
  nbr: number
  authorId: number
}

const post1 = {
  id: 1,
  title: 't1',
  contents: 'c1',
  nbr: 18,
  authorId: 1,
}

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
      sqliteConverter,
      []
    )
  // should throw for improperly typed input
  t.throws(() => liftedTransform(post1), {
    instanceOf: InvalidRecordTransformationError,
  })
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
      sqliteConverter,
      ['title']
    )
  t.throws(() => liftedTransform(post1), {
    instanceOf: InvalidRecordTransformationError,
  })
})

test('setReplicationTransform throws an error if table does not exist', (t) => {
  t.throws(
    () => {
      setReplicationTransform(
        schema,
        undefined as any, // won't be used anyway
        new QualifiedTablename('main', 'non_existent_table'),
        {
          transformInbound: (_) => _,
          transformOutbound: (_) => _,
        }
      )
    },
    {
      message: `Cannot set replication transform for table 'non_existent_table'. Table does not exist in the database schema.`,
    }
  )
})
