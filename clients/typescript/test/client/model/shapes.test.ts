import testAny, { TestFn, ExecutionContext } from 'ava'
import Log from 'loglevel'
import Database from 'better-sqlite3'
import { schema } from '../generated'
import { DatabaseAdapter } from '../../../src/drivers/better-sqlite3'
import { SatelliteProcess } from '../../../src/satellite/process'
import { MockSatelliteClient } from '../../../src/satellite/mock'
import { BundleMigrator } from '../../../src/migrators'
import { MockNotifier } from '../../../src/notifiers'
import { randomValue } from '../../../src/util'
import { ElectricClient } from '../../../src/client/model/client'
import { cleanAndStopSatellite } from '../../satellite/common'
import { satelliteDefaults } from '../../../src/satellite/config'

const test = testAny as TestFn<ContextType>

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

const config = {
  auth: {
    token: 'test-token',
  },
}

async function makeContext(t: ExecutionContext<ContextType>) {
  const db = new Database(':memory:')

  const client = new MockSatelliteClient()
  const adapter = new DatabaseAdapter(db)
  const migrations = schema.migrations
  const migrator = new BundleMigrator(adapter, migrations)
  const dbName = `.tmp/test-${randomValue()}.db`
  const notifier = new MockNotifier(dbName)

  const satellite = new SatelliteProcess(
    dbName,
    adapter,
    migrator,
    notifier,
    client,
    satelliteDefaults
  )

  const electric = ElectricClient.create(schema, adapter, notifier, satellite)
  const Post = electric.db.Post
  const Items = electric.db.Items
  const User = electric.db.User
  const Profile = electric.db.Profile

  const runMigrations = async () => {
    return await migrator.up()
  }

  t.context = {
    dbName,
    db,
    satellite,
    client,
    runMigrations,
    electric,
    Post,
    Items,
    User,
    Profile,
  }

  init(t.context)
}

type TableType<T extends keyof ElectricClient<typeof schema>['db']> =
  ElectricClient<typeof schema>['db'][T]
type ContextType = {
  dbName: string
  db: any
  satellite: SatelliteProcess
  client: MockSatelliteClient
  runMigrations: () => Promise<number>
  electric: ElectricClient<typeof schema>
  Post: TableType<'Post'>
  Items: TableType<'Items'>
  User: TableType<'User'>
  Profile: TableType<'Profile'>
}

// Create a Post table in the DB first
function init({ db }: ContextType) {
  db.exec('DROP TABLE IF EXISTS Post')
  db.exec(
    "CREATE TABLE IF NOT EXISTS Post('id' int PRIMARY KEY, 'title' varchar, 'contents' varchar, 'nbr' int, 'authorId' int);"
  )

  db.exec('DROP TABLE IF EXISTS Profile')
  db.exec(
    "CREATE TABLE IF NOT EXISTS Profile('id' int PRIMARY KEY, 'bio' varchar, 'userId' int);"
  )

  log = []
}

test.beforeEach(makeContext)
test.afterEach.always((t: ExecutionContext<ContextType>) => {
  return cleanAndStopSatellite(t)
})

test.serial('Read queries issue warning if table is not synced', async (t) => {
  const { Post } = t.context as ContextType
  t.assert(log.length === 0)
  await Post.findMany()
  t.deepEqual(log, ['Reading from unsynced table Post'])
})

test.serial('Upsert query issues warning if table is not synced', async (t) => {
  const { Post } = t.context as ContextType
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

const relations = {
  Post: {
    id: 0,
    schema: 'public',
    table: 'Post',
    tableType: 0,
    columns: [
      {
        name: 'id',
        type: 'INTEGER',
        isNullable: false,
        primaryKey: true,
      },
      {
        name: 'title',
        type: 'TEXT',
        isNullable: true,
        primaryKey: false,
      },
      {
        name: 'contents',
        type: 'TEXT',
        isNullable: true,
        primaryKey: false,
      },
      {
        name: 'nbr',
        type: 'INTEGER',
        isNullable: true,
        primaryKey: false,
      },
      {
        name: 'authorId',
        type: 'INTEGER',
        isNullable: true,
        primaryKey: false,
      },
    ],
  },
  Profile: {
    id: 1,
    schema: 'public',
    table: 'Profile',
    tableType: 0,
    columns: [
      {
        name: 'id',
        type: 'INTEGER',
        isNullable: false,
        primaryKey: true,
      },
      {
        name: 'bio',
        type: 'TEXT',
        isNullable: true,
        primaryKey: false,
      },
      {
        name: 'userId',
        type: 'INTEGER',
        isNullable: true,
        primaryKey: false,
      },
    ],
  },
}

const post = {
  id: 1,
  title: 'foo',
  contents: 'bar',
  nbr: 5,
  authorId: 1,
}

const profile = {
  id: 8,
  bio: 'foo',
  userId: 1,
}

test.serial('promise resolves when subscription starts loading', async (t) => {
  const { satellite, client } = t.context as ContextType
  await satellite.start(config.auth)

  client.setRelations(relations)
  client.setRelationData('Post', post)

  const { Post } = t.context as ContextType
  const { synced } = await Post.sync()
  // always await this promise otherwise the next test may issue a subscription
  // while this one is not yet fulfilled and that will lead to issues
  await synced
  t.pass()
})

test.serial(
  'synced promise resolves when subscription is fulfilled',
  async (t) => {
    const { satellite, client } = t.context as ContextType
    await satellite.start(config.auth)

    // We can request a subscription
    client.setRelations(relations)
    client.setRelationData('Profile', profile)

    const { Profile } = t.context as ContextType
    const { synced: profileSynced } = await Profile.sync()

    // Once the subscription has been acknowledged
    // we can request another one
    client.setRelations(relations)
    client.setRelationData('Post', post)

    const { Post } = t.context as ContextType
    const { synced } = await Post.sync()
    await synced

    // Check that the data was indeed received
    const posts = await Post.findMany()
    t.deepEqual(posts, [post])

    await profileSynced
  }
)

test.serial('promise is rejected on failed subscription request', async (t) => {
  const { satellite } = t.context as ContextType
  await satellite.start(config.auth)

  const { Items } = t.context as ContextType
  try {
    await Items.sync()
    t.fail()
  } catch (_e) {
    t.pass()
  }
})

test.serial('synced promise is rejected on invalid shape', async (t) => {
  const { satellite, User } = t.context as ContextType
  await satellite.start(config.auth)

  let loadingPromResolved = false

  try {
    const { synced } = await User.sync()
    loadingPromResolved = true
    await synced
    t.fail()
  } catch (_e) {
    // fails if first promise got rejected
    // instead of the `synced` promise
    t.assert(loadingPromResolved)
    t.pass()
  }
})
