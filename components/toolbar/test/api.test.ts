import { vi, expect, test, describe, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { MockRegistry } from 'electric-sql/satellite'
import { electrify } from 'electric-sql/drivers/better-sqlite3'
import { schema } from './generated'
import { clientApi } from '../src'
import { MockIndexDB, MockLocation } from './mocks'
import { ConnectivityState } from 'electric-sql/util'

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

describe('api', () => {
  beforeEach(() => {
    clear()
    electric.satellite.connectivityState = { status: 'disconnected' }
    vi.unstubAllGlobals()
  })

  test('getSatelliteNames', async () => {
    const api = clientApi(electric.registry)
    const names = api.getSatelliteNames()
    expect(names).toStrictEqual([':memory:'])
  })

  test('queryDb', async () => {
    const api = clientApi(electric.registry)
    const query =
      'SELECT name FROM sqlite_schema\n' +
      "WHERE type='table'\n" +
      'ORDER BY name; '
    const result = await api.queryDb(':memory:', { sql: query })
    const expected = [{ name: 'Post' }, { name: 'Profile' }, { name: 'User' }]
    expect(result).toStrictEqual(expected)
  })

  test('resetDb', async () => {
    const mock = new MockIndexDB()
    const mockLocation = new MockLocation()
    vi.stubGlobal('window', {
      ...window,
      indexedDB: mock,
      location: mockLocation,
    })

    const api = clientApi(electric.registry)
    await api.resetDb(':memory:')
    const deleted = mock.deletedDatabases()
    expect(deleted).toStrictEqual([':memory:'])
  })

  test('getSatelliteStatus', async () => {
    const api = clientApi(electric.registry)
    const result = await api.getSatelliteStatus(':memory:')
    expect(result?.status).toStrictEqual('disconnected')
  })

  test('subscribeToSatelliteStatus', async () => {
    const api = clientApi(electric.registry)
    const states: ConnectivityState[] = []
    const unsubscribe = api.subscribeToSatelliteStatus(':memory:', (state) => {
      states.push(state)
    })

    expect(states).toHaveLength(1)
    expect(states[0].status).toStrictEqual('disconnected')
    electric.satellite.notifier.connectivityStateChanged(':memory:', {
      status: 'connected',
    })

    expect(states).toHaveLength(2)
    expect(states[1].status).toStrictEqual('connected')

    unsubscribe()
    electric.satellite.notifier.connectivityStateChanged(':memory:', {
      status: 'disconnected',
    })
    expect(states).toHaveLength(2)
  })

  test('toggleSatelliteStatus', async () => {
    const api = clientApi(electric.registry)
    const connectSpy = vi.spyOn(electric.satellite, 'connectWithBackoff')
    const disconnectSpy = vi.spyOn(electric.satellite, 'clientDisconnect')

    await api.toggleSatelliteStatus(':memory:')
    expect(connectSpy).toHaveBeenCalledOnce()
    expect(disconnectSpy).not.toHaveBeenCalled()

    electric.satellite.connectivityState = { status: 'connected' }
    await api.toggleSatelliteStatus(':memory:')
    expect(disconnectSpy).toHaveBeenCalledOnce()
  })
})
