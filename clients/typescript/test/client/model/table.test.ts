import test from 'ava'
import Database from 'better-sqlite3'

import { MockRegistry } from '../../../src/satellite/mock'

import { electrify } from '../../../src/drivers/better-sqlite3'
import { schema } from '../generated'
import { makeContext } from '../../satellite/common'
import { globalRegistry } from '../../../src/satellite'
import { ElectricClient } from '../../../src/client/model'
import { InvalidRecordTransformationError } from '../../../src/client/validation/errors/invalidRecordTransformationError'
import { QualifiedTablename } from '../../../src/util'

const db = new Database(':memory:')
const electric = await electrify(
  db,
  schema,
  {},
  { registry: new MockRegistry() }
)

const electricDb = electric.db

const post1 = {
  id: 1,
  title: 't1',
  contents: 'c1',
  nbr: 18,
  authorId: 1,
}

const author1 = {
  id: 1,
  name: 'alice',
  meta: null,
}

// Create a Post table in the DB first
function clear() {
  db.exec('DROP TABLE IF EXISTS Post')
  db.exec(
    "CREATE TABLE IF NOT EXISTS Post('id' int PRIMARY KEY, 'title' varchar, 'contents' varchar, 'nbr' int, 'authorId' int);"
  )
  db.exec('DROP TABLE IF EXISTS User')
  db.exec(
    "CREATE TABLE IF NOT EXISTS User('id' int PRIMARY KEY, 'name' varchar, 'meta' varchar);"
  )
  db.exec('DROP TABLE IF EXISTS Profile')
  db.exec(
    "CREATE TABLE IF NOT EXISTS Profile('id' int PRIMARY KEY, 'bio' varchar, 'meta' json, 'userId' int, 'imageId' varchar);"
  )
  db.exec('DROP TABLE IF EXISTS ProfileImage')
  db.exec(
    "CREATE TABLE IF NOT EXISTS ProfileImage('id' varchar PRIMARY KEY, 'image' blob);"
  )
}

clear()

test.serial('raw query', async (t) => {
  await electric.adapter.run({
    sql: `INSERT INTO Post (id, title, contents, nbr, authorId) VALUES (?, ?, ?, ?, ?)`,
    args: [post1.id, post1.title, post1.contents, post1.nbr, post1.authorId],
  })

  const res = await electricDb.rawQuery({
    sql: 'SELECT * FROM Post WHERE id = ?',
    args: [post1.id],
  })
  t.is(res.length, 1)
  t.deepEqual(res[0], post1)
})

test('setReplicationTransform should validate transform does not modify outgoing FK column', async (t: any) => {
  await makeContext(t, 'main')

  const { adapter, notifier, satellite, client } = t.context

  const electric = await ElectricClient.create(
    'testDB',
    schema,
    adapter,
    notifier,
    satellite,
    globalRegistry,
    'SQLite'
  )

  const modifyAuthorId = (post: any) => ({
    ...post,
    authorId: 9, // this is a FK, should not be allowed to modify it
  })

  electric.setReplicationTransform(new QualifiedTablename('main', 'Post'), {
    transformInbound: modifyAuthorId,
    transformOutbound: modifyAuthorId,
  })

  // Check outbound transform
  t.throws(
    () => client.replicationTransforms.get('Post').transformOutbound(post1),
    {
      instanceOf: InvalidRecordTransformationError,
      message: 'Record transformation modified immutable fields: authorId',
    }
  )

  // Also check inbound transform
  t.throws(
    () => client.replicationTransforms.get('Post').transformInbound(post1),
    {
      instanceOf: InvalidRecordTransformationError,
      message: 'Record transformation modified immutable fields: authorId',
    }
  )
})

test('setReplicationTransform should validate transform does not modify incoming FK column', async (t: any) => {
  await makeContext(t, 'main')

  const { adapter, notifier, satellite, client } = t.context

  const electric = await ElectricClient.create(
    'testDB',
    schema,
    adapter,
    notifier,
    satellite,
    globalRegistry,
    'SQLite'
  )

  const modifyUserId = (user: any) => ({
    ...user,
    id: 9, // this is the column pointed at by the FK, should not be allowed to modify it
  })

  // postTable, userTable
  electric.setReplicationTransform(new QualifiedTablename('main', 'User'), {
    transformInbound: modifyUserId,
    transformOutbound: modifyUserId,
  })

  // Check outbound transform
  t.throws(
    () => {
      client.replicationTransforms.get('User').transformOutbound(author1)
    },
    {
      instanceOf: InvalidRecordTransformationError,
      message: 'Record transformation modified immutable fields: id',
    }
  )

  // Also check inbound transform
  t.throws(
    () => client.replicationTransforms.get('User').transformInbound(author1),
    {
      instanceOf: InvalidRecordTransformationError,
      message: 'Record transformation modified immutable fields: id',
    }
  )
})
