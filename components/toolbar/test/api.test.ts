import { vi, expect, test, describe, beforeEach, afterAll } from 'vitest'
import Database from 'better-sqlite3'
import { electrify as electrifySqlite } from 'electric-sql/drivers/better-sqlite3'
import { PGlite } from '@electric-sql/pglite'
import { electrify as electrifyPg } from 'electric-sql/drivers/pglite'
import { MockRegistry } from 'electric-sql/satellite'
import { schema } from './generated'
import { clientApi } from '../src'
import { MockIndexDB, MockLocation } from './mocks'
import { ConnectivityState, QualifiedTablename } from 'electric-sql/util'

interface TestConfig {
  dialect: 'sqlite' | 'postgres'
  electrify: typeof electrifySqlite | typeof electrifyPg
  initializeDb: () => unknown
}

const configurations: TestConfig[] = [
  {
    dialect: 'sqlite',
    electrify: electrifySqlite,
    initializeDb: () => new Database(':memory:'),
  },
  {
    dialect: 'postgres',
    electrify: electrifyPg,
    initializeDb: () => new PGlite('memory://:memory:'),
  },
]

describe.each(configurations)(`api - $dialect`, async (config) => {
  // @ts-expect-error using different electrification for each db
  const electric = await config.electrify(
    config.initializeDb(),
    schema,
    {},
    { registry: new MockRegistry() },
  )
  const db = electric.adapter

  await electric.connect('test-token')

  // Create some tables in the DB first
  async function clear() {
    console.log('whatsap')
    await db.run({ sql: 'DROP TABLE IF EXISTS Post' })
    console.log('got here')
    await db.run({
      sql: 'CREATE TABLE IF NOT EXISTS Post(id int PRIMARY KEY, title varchar, contents varchar, nbr int, authorId int);',
    })
    await db.run({ sql: 'DROP TABLE IF EXISTS Users' })
    await db.run({
      sql: 'CREATE TABLE IF NOT EXISTS Users(id int PRIMARY KEY, name varchar);',
    })
    await db.run({ sql: 'DROP TABLE IF EXISTS Profile' })
    await db.run({
      sql: 'CREATE TABLE IF NOT EXISTS Profile(id int PRIMARY KEY, bio varchar, userId int);',
    })
  }

  beforeEach(async () => {
    await clear()
    electric.satellite.connectivityState = { status: 'disconnected' }
    vi.unstubAllGlobals()
  })

  afterAll(async () => {
    await electric.close()
  })

  test('getSatelliteNames', async () => {
    const api = clientApi(electric.registry)
    const names = api.getSatelliteNames()
    expect(names).toStrictEqual([':memory:'])
  })

  test('queryDb', async () => {
    const api = clientApi(electric.registry)
    const query =
      config.dialect === 'sqlite'
        ? `SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name;`
        : `SELECT table_name as name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;`

    const result = (await api.queryDb(':memory:', { sql: query })) as {
      name: string
    }[]
    const expected = [{ name: 'post' }, { name: 'profile' }, { name: 'users' }]
    expect(
      result.map((o) => ({
        name: o.name.toLowerCase(),
      })),
    ).toStrictEqual(expected)
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

  test('getDbDialect', async () => {
    const api = clientApi(electric.registry)
    const dialect = await api.getDbDialect(':memory:')
    expect(dialect).toBe(config.dialect)
  })

  test('getDbTables', async () => {
    const api = clientApi(electric.registry)

    const tables = await api.getDbTables(':memory:')
    expect(tables).toHaveLength(3)
    expect(
      tables
        .map((tb) => tb.name)
        .sort()
        .map((s) => s.toLowerCase()),
    ).toEqual(['Post', 'Users', 'Profile'].sort().map((s) => s.toLowerCase()))

    // should have SQL schema and column definitions
    const profileTblInfo = tables.find(
      (t) => t.name.toLowerCase() === 'profile',
    )!

    expect(profileTblInfo.name.toLowerCase()).toBe('profile')
    if (config.dialect === 'sqlite') {
      expect(profileTblInfo.sql).toBe(
        'CREATE TABLE Profile(id int PRIMARY KEY, bio varchar, userId int)',
      )
    }
    expect(profileTblInfo.columns).toEqual(
      config.dialect === 'sqlite'
        ? [
            {
              name: 'id',
              type: 'INT',
              nullable: true,
            },
            {
              name: 'bio',
              type: 'varchar',
              nullable: true,
            },
            {
              name: 'userId',
              type: 'INT',
              nullable: true,
            },
          ]
        : [
            {
              name: 'id',
              type: 'integer',
              nullable: false,
            },
            {
              name: 'bio',
              type: 'character varying',
              nullable: true,
            },
            {
              name: 'userid',
              type: 'integer',
              nullable: true,
            },
          ],
    )
  })

  test('subscribeToDbTable', async () => {
    const api = clientApi(electric.registry)
    let numProfileTableCbs = 0
    let numUserTableCbs = 0
    let numInternalTableCbs = 0
    const unsubscribeProfile = api.subscribeToDbTable(
      ':memory:',
      'Profile',
      () => {
        numProfileTableCbs++
      },
    )
    const unsubscribeUser = api.subscribeToDbTable(':memory:', 'Users', () => {
      numUserTableCbs++
    })

    const unsubscribeInternal = api.subscribeToDbTable(
      ':memory:',
      '_electric_oplog',
      () => {
        numInternalTableCbs++
      },
    )

    expect(numProfileTableCbs).toBe(0)
    expect(numUserTableCbs).toBe(0)
    expect(numInternalTableCbs).toBe(0)

    electric.satellite.notifier.actuallyChanged(
      ':memory:',
      [
        {
          qualifiedTablename: new QualifiedTablename('public', 'Profile'),
        },
      ],
      'local',
    )

    expect(numProfileTableCbs).toBe(1)
    expect(numUserTableCbs).toBe(0)
    expect(numInternalTableCbs).toBe(1)

    electric.satellite.notifier.actuallyChanged(
      ':memory:',
      [
        {
          qualifiedTablename: new QualifiedTablename('public', 'Users'),
        },
      ],
      'remote',
    )

    expect(numProfileTableCbs).toBe(1)
    expect(numUserTableCbs).toBe(1)
    expect(numInternalTableCbs).toBe(2)

    unsubscribeProfile()
    unsubscribeUser()
    unsubscribeInternal()
    electric.satellite.notifier.actuallyChanged(
      ':memory:',
      [
        {
          qualifiedTablename: new QualifiedTablename('public', 'Users'),
        },
      ],
      'remote',
    )
    expect(numProfileTableCbs).toBe(1)
    expect(numUserTableCbs).toBe(1)
    expect(numInternalTableCbs).toBe(2)
  })
})
