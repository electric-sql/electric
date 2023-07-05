import test from 'ava'
import Log from 'loglevel'
import Database from 'better-sqlite3'
import { dbSchema, Post } from '../generated'
import { electrify } from '../../../src/drivers/better-sqlite3'
import {
  shapeManager,
  ShapeManagerMock,
} from '../../../src/client/model/shapes'

// Modify `loglevel` to store the logged messages
// based on "Writing plugins" in https://github.com/pimterry/loglevel
type LoggedMsg = string
let log: Array<LoggedMsg> = []
const originalFactory = Log.methodFactory
Log.methodFactory = function (methodName, logLevel, loggerName) {
  var rawMethod = originalFactory(methodName, logLevel, loggerName)

  return function (message) {
    log.push(message)
    if (message !== 'Reading from unsynced table Post') {
      rawMethod(message)
    }
  }
}
Log.setLevel(Log.getLevel()) // Be sure to call setLevel method in order to apply plugin

// Use a mocked shape manager for these tests
// which does not wait for Satellite
// to acknowledge the subscription
Object.setPrototypeOf(shapeManager, ShapeManagerMock.prototype)

const db = new Database(':memory:')
const config = {
  auth: {
    token: 'test-token',
  },
}
const electric = await electrify(db, dbSchema, config)
const Post = electric.db.Post

// Create a Post table in the DB first
function init() {
  db.exec('DROP TABLE IF EXISTS Post')
  db.exec(
    "CREATE TABLE IF NOT EXISTS Post('id' int PRIMARY KEY, 'title' varchar, 'contents' varchar, 'nbr' int, 'authorId' int);"
  )

  log = []
}

test.beforeEach(init)

test.serial('Read queries issue warning if table is not synced', async (t) => {
  t.assert(log.length === 0)
  await Post.findMany()
  t.deepEqual(log, ['Reading from unsynced table Post'])
})

test.serial('Upsert query issues warning if table is not synced', async (t) => {
  t.assert(log.length === 0)

  const newPost = {
    id: 4,
    title: 't4',
    contents: 'c4',
    nbr: 5,
    authorId: 1,
  }

  const updatePost = { title: 'Modified title' }

  await Post.upsert({
    create: newPost,
    update: updatePost,
    where: {
      id: newPost.id,
    },
  })

  // The log contains the warning twice
  // because upsert first tries to find the record
  // and then reads the created/updated record
  // and both of those reads will raise the warning
  t.deepEqual(log, [
    'Reading from unsynced table Post',
    'Reading from unsynced table Post',
  ])
})

test.serial(
  'Read queries no longer warn after syncing the table',
  async (t) => {
    t.assert(log.length === 0)
    await Post.sync() // syncs only the Post table
    await Post.findMany() // now we can query it
    t.assert(log.length === 0)
  }
)
