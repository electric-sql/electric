import { vi, expect, test } from 'vitest'
import Database from 'better-sqlite3'
import { MockRegistry } from 'electric-sql/satellite'
import { electrify } from 'electric-sql/drivers/better-sqlite3'
import { schema } from './generated'
import { clientApi } from '../src'
import { MockIndexDB, MockLocation } from './mocks'

const db = new Database(':memory:')
const electric = await electrify(
  db,
  schema,
  {},
  { registry: new MockRegistry() },
)

await electric.connect('test-token')

// test boilerplate copied from electric-sql/test/client/model/table.test.ts

const tbl = electric.db.Post
const postTable = tbl
const userTable = electric.db.User
const profileTable = electric.db.Profile

// Sync all shapes such that we don't get warnings on every query
await postTable.sync()
await userTable.sync()
await profileTable.sync()

// Create a Post table in the DB first
function clear() {
  db.exec('DROP TABLE IF EXISTS Post')
  db.exec(
    "CREATE TABLE IF NOT EXISTS Post('id' int PRIMARY KEY, 'title' varchar, 'contents' varchar, 'nbr' int, 'authorId' int);",
  )
  db.exec('DROP TABLE IF EXISTS User')
  db.exec(
    "CREATE TABLE IF NOT EXISTS User('id' int PRIMARY KEY, 'name' varchar);",
  )
  db.exec('DROP TABLE IF EXISTS Profile')
  db.exec(
    "CREATE TABLE IF NOT EXISTS Profile('id' int PRIMARY KEY, 'bio' varchar, 'userId' int);",
  )
}

test('get_satellite_names', async () => {
  clear()
  const api = clientApi(electric.registry)
  const names = api.getSatelliteNames()
  expect(names).toStrictEqual([':memory:'])
})

test('query_db', async () => {
  clear()
  const api = clientApi(electric.registry)
  const query =
    'SELECT name FROM sqlite_schema\n' +
    "WHERE type='table'\n" +
    'ORDER BY name; '
  const result = await api.queryDB(':memory:', { sql: query })
  const expected = [{ name: 'Post' }, { name: 'Profile' }, { name: 'User' }]
  expect(result).toStrictEqual(expected)
})

test('get_status', async () => {
  clear()
  const api = clientApi(electric.registry)
  const result = await api.getSatelliteStatus(':memory:')
  expect(result?.status).toStrictEqual('disconnected')
})

test('reset_db', async () => {
  clear()
  const mock = new MockIndexDB()
  const mockLocation = new MockLocation()
  vi.stubGlobal('window', {
    ...window,
    indexedDB: mock,
    location: mockLocation,
  })

  // browserEnv.stub('window.indexedDB', mock)
  // browserEnv.stub('window.location', mockLocation)
  const api = clientApi(electric.registry)
  await api.resetDB(':memory:')
  const deleted = mock.deletedDatabases()
  expect(deleted).toStrictEqual([':memory:'])
  vi.unstubAllGlobals()
})
