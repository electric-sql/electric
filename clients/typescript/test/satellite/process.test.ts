import test from 'ava'

import { DatabaseAdapter } from '../../src/drivers/better-sqlite3/adapter'
import {
  MOCK_BEHIND_WINDOW_LSN,
  MOCK_INVALID_POSITION_LSN,
  MockSatelliteClient,
} from '../../src/satellite/mock'
import { QualifiedTablename } from '../../src/util/tablename'
import { sleepAsync } from '../../src/util/timer'
import { AuthState } from '../../src/auth/index'

import {
  OPTYPES,
  localOperationsToTableChanges,
  fromTransaction,
  OplogEntry,
  toTransactions,
  generateTag,
  encodeTags,
  opLogEntryToChange,
} from '../../src/satellite/oplog'
import { SatelliteProcess } from '../../src/satellite/process'

import {
  loadSatelliteMetaTable,
  generateLocalOplogEntry,
  generateRemoteOplogEntry,
  genEncodedTags,
  TableInfo,
} from '../support/satellite-helpers'
import Long from 'long'
import {
  DataChangeType,
  ConnectivityState,
  LSN,
  Relation,
  SqlValue,
  DataTransaction,
  SatelliteErrorCode,
  RelationsCache,
} from '../../src/util/types'
import { makeContext, opts, relations, cleanAndStopSatellite } from './common'
import { Satellite } from '../../src/satellite'
import { DEFAULT_LOG_POS, numberToBytes, base64 } from '../../src/util/common'

import { EventNotifier } from '../../src/notifiers'
import { ClientShapeDefinition } from '../../src/satellite/shapes/types'

interface TestNotifier extends EventNotifier {
  notifications: any[]
}

interface TestSatellite extends Satellite {
  _lastSentRowId: number
  _authState: AuthState
  relations: RelationsCache

  _setAuthState(authState: AuthState): Promise<void>
  _performSnapshot(): Promise<Date>
  _getEntries(): Promise<OplogEntry[]>
  _apply(incoming: OplogEntry[], lsn?: LSN): Promise<void>
  _applyTransaction(transaction: DataTransaction): any
  _setMeta(key: string, value: SqlValue): Promise<void>
  _getMeta(key: string): Promise<string>
  _ack(lsn: number, isAck: boolean): Promise<void>
  _connectivityStateChange(status: ConnectivityState): void
  _getLocalRelations(): Promise<{ [k: string]: Relation }>
}

type ContextType = {
  dbName: string
  adapter: DatabaseAdapter
  notifier: TestNotifier
  satellite: TestSatellite
  client: MockSatelliteClient
  runMigrations: () => Promise<void>
  tableInfo: TableInfo
  timestamp: number
  authState: AuthState
}

test.beforeEach(makeContext)
test.afterEach.always(cleanAndStopSatellite)

test('setup starts a satellite process', async (t) => {
  const { satellite } = t.context as ContextType

  t.true(satellite instanceof SatelliteProcess)
})

test('start creates system tables', async (t) => {
  const { adapter, satellite, authState } = t.context as ContextType

  await satellite.start(authState)

  const sql = "select name from sqlite_master where type = 'table'"
  const rows = await adapter.query({ sql })
  const names = rows.map((row) => row.name)

  t.true(names.includes('_electric_oplog'))
})

test('load metadata', async (t) => {
  const { adapter, runMigrations } = t.context as ContextType
  await runMigrations()

  const meta = await loadSatelliteMetaTable(adapter)
  t.deepEqual(meta, {
    compensations: 0,
    lastAckdRowId: '0',
    lastSentRowId: '0',
    lsn: '',
    clientId: '',
    subscriptions: '',
  })
})

test('set persistent client id', async (t) => {
  const { satellite, authState } = t.context as ContextType

  await satellite.start(authState)
  const clientId1 = satellite['_authState']['clientId']
  await satellite.stop()

  await satellite.start(authState)

  const clientId2 = satellite['_authState']['clientId']

  t.assert(clientId1 === clientId2)
})

test('cannot UPDATE primary key', async (t) => {
  const { adapter, runMigrations } = t.context as ContextType
  await runMigrations()

  await adapter.run({ sql: `INSERT INTO parent(id) VALUES ('1'),('2')` })
  await t.throwsAsync(
    adapter.run({ sql: `UPDATE parent SET id='3' WHERE id = '1'` }),
    {
      code: 'SQLITE_CONSTRAINT_TRIGGER',
    }
  )
})

test('snapshot works', async (t) => {
  const { satellite } = t.context as ContextType
  const { adapter, notifier, runMigrations, authState } =
    t.context as ContextType
  await runMigrations()
  await satellite._setAuthState(authState)

  await adapter.run({ sql: `INSERT INTO parent(id) VALUES ('1'),('2')` })

  let snapshotTimestamp = await satellite._performSnapshot()

  const clientId = satellite['_authState']['clientId']
  let shadowTags = encodeTags([generateTag(clientId, snapshotTimestamp)])

  var shadowRows = await adapter.query({
    sql: `SELECT tags FROM _electric_shadow`,
  })
  t.is(shadowRows.length, 2)
  for (const row of shadowRows) {
    t.is(row.tags, shadowTags)
  }

  t.is(notifier.notifications.length, 1)

  const { changes } = notifier.notifications[0]
  const expectedChange = {
    qualifiedTablename: new QualifiedTablename('main', 'parent'),
    rowids: [1, 2],
  }

  t.deepEqual(changes, [expectedChange])
})

// XXX cut out the test below to a seperate file to avoid
// intermittent behaviour.

// test('throttled snapshot respects window', async t => {
//   const { adapter, notifier, runMigrations, satellite } = t.context as any
//   await runMigrations()

//   await satellite._throttledSnapshot()
//   const numNotifications = notifier.notifications.length

//   await adapter.run(`INSERT INTO parent(id) VALUES ('1'),('2')`)
//   await satellite._throttledSnapshot()

//   t.is(notifier.notifications.length, numNotifications)

//   await sleepAsync(opts.minSnapshotWindow)

//   t.is(notifier.notifications.length, numNotifications + 1)
// })

test('starting and stopping the process works', async (t) => {
  const { adapter, notifier, runMigrations, satellite, authState } =
    t.context as ContextType
  await runMigrations()

  await adapter.run({ sql: `INSERT INTO parent(id) VALUES ('1'),('2')` })

  await satellite.start(authState)

  await sleepAsync(opts.pollingInterval)

  t.is(notifier.notifications.length, 1)

  await adapter.run({ sql: `INSERT INTO parent(id) VALUES ('3'),('4')` })
  await sleepAsync(opts.pollingInterval)

  t.is(notifier.notifications.length, 2)

  await satellite.stop()
  await adapter.run({ sql: `INSERT INTO parent(id) VALUES ('5'),('6')` })
  await sleepAsync(opts.pollingInterval)

  t.is(notifier.notifications.length, 2)

  await satellite.start(authState)
  await sleepAsync(0)

  t.is(notifier.notifications.length, 3)
})

test('snapshots on potential data change', async (t) => {
  const { adapter, notifier, runMigrations } = t.context as ContextType
  await runMigrations()

  await adapter.run({ sql: `INSERT INTO parent(id) VALUES ('1'),('2')` })

  t.is(notifier.notifications.length, 0)

  await notifier.potentiallyChanged()

  t.is(notifier.notifications.length, 1)
})

// INSERT after DELETE shall nullify all non explicitly set columns
// If last operation is a DELETE, concurrent INSERT shall resurrect deleted
// values as in 'INSERT wins over DELETE and restored deleted values'
test('snapshot of INSERT after DELETE', async (t) => {
  const { adapter, runMigrations, satellite, authState } =
    t.context as ContextType
  try {
    await runMigrations()

    await adapter.run({
      sql: `INSERT INTO parent(id, value) VALUES (1,'val1')`,
    })
    await adapter.run({ sql: `DELETE FROM parent WHERE id=1` })
    await adapter.run({ sql: `INSERT INTO parent(id) VALUES (1)` })

    await satellite._setAuthState(authState)
    await satellite._performSnapshot()
    const entries = await satellite._getEntries()
    const clientId = satellite['_authState']['clientId']

    const merged = localOperationsToTableChanges(entries, (timestamp: Date) => {
      return generateTag(clientId, timestamp)
    })
    const [_, keyChanges] = merged['main.parent']['1']
    const resultingValue = keyChanges.changes.value.value
    t.is(resultingValue, null)
  } catch (error) {
    console.log(error)
  }
})

test('take snapshot and merge local wins', async (t) => {
  const { adapter, runMigrations, satellite, tableInfo, authState } =
    t.context as any
  await runMigrations()

  const incomingTs = new Date().getTime() - 1
  const incomingEntry = generateRemoteOplogEntry(
    tableInfo,
    'main',
    'parent',
    OPTYPES.insert,
    incomingTs,
    encodeTags([generateTag('remote', new Date(incomingTs))]),
    {
      id: 1,
      value: 'incoming',
    }
  )
  await adapter.run({
    sql: `INSERT INTO parent(id, value, other) VALUES (1, 'local', 1)`,
  })

  await satellite._setAuthState(authState)
  const localTime = await satellite._performSnapshot()
  const clientId = satellite['_authState']['clientId']

  const local = await satellite._getEntries()
  const localTimestamp = new Date(local[0].timestamp).getTime()
  const merged = satellite._mergeEntries(clientId, local, 'remote', [
    incomingEntry,
  ])
  const item = merged['main.parent']['1']

  t.deepEqual(item, {
    namespace: 'main',
    tablename: 'parent',
    primaryKeyCols: { id: 1 },
    optype: OPTYPES.upsert,
    changes: {
      id: { value: 1, timestamp: localTimestamp },
      value: { value: 'local', timestamp: localTimestamp },
      other: { value: 1, timestamp: localTimestamp },
    },
    fullRow: {
      id: 1,
      value: 'local',
      other: 1,
    },
    tags: [
      generateTag(clientId, localTime),
      generateTag('remote', new Date(incomingTs)),
    ],
  })
})

test('take snapshot and merge incoming wins', async (t) => {
  const { adapter, runMigrations, satellite, tableInfo, authState } =
    t.context as any
  await runMigrations()

  await adapter.run({
    sql: `INSERT INTO parent(id, value, other) VALUES (1, 'local', 1)`,
  })

  await satellite._setAuthState(authState)
  const clientId = satellite['_authState']['clientId']
  await satellite._performSnapshot()

  const local = await satellite._getEntries()
  const localTimestamp = new Date(local[0].timestamp).getTime()

  const incomingTs = localTimestamp + 1
  const incomingEntry = generateRemoteOplogEntry(
    tableInfo,
    'main',
    'parent',
    OPTYPES.insert,
    incomingTs,
    genEncodedTags('remote', [incomingTs]),
    {
      id: 1,
      value: 'incoming',
    }
  )

  const merged = satellite._mergeEntries(clientId, local, 'remote', [
    incomingEntry,
  ])
  const item = merged['main.parent']['1']

  t.deepEqual(item, {
    namespace: 'main',
    tablename: 'parent',
    primaryKeyCols: { id: 1 },
    optype: OPTYPES.upsert,
    changes: {
      id: { value: 1, timestamp: incomingTs },
      value: { value: 'incoming', timestamp: incomingTs },
      other: { value: 1, timestamp: localTimestamp },
    },
    fullRow: {
      id: 1,
      value: 'incoming',
      other: 1,
    },
    tags: [
      generateTag(clientId, new Date(localTimestamp)),
      generateTag('remote', new Date(incomingTs)),
    ],
  })
})

test('apply does not add anything to oplog', async (t) => {
  const { adapter, runMigrations, satellite, tableInfo, authState } =
    t.context as any
  await runMigrations()
  await adapter.run({
    sql: `INSERT INTO parent(id, value, other) VALUES (1, 'local', null)`,
  })

  await satellite._setAuthState(authState)
  const clientId = satellite['_authState']['clientId']

  const localTimestamp = await satellite._performSnapshot()

  const incomingTs = new Date().getTime()
  const incomingEntry = generateRemoteOplogEntry(
    tableInfo,
    'main',
    'parent',
    OPTYPES.insert,
    incomingTs,
    genEncodedTags('remote', [incomingTs]),
    {
      id: 1,
      value: 'incoming',
      other: 1,
    }
  )

  satellite.relations = relations // satellite must be aware of the relations in order to turn `DataChange`s into `OpLogEntry`s

  const incomingChange = opLogEntryToChange(incomingEntry, relations)
  const incomingTx = {
    origin: 'remote',
    commit_timestamp: Long.fromNumber(incomingTs),
    changes: [incomingChange],
    lsn: new Uint8Array(),
  }
  await satellite._applyTransaction(incomingTx)

  await satellite._performSnapshot()

  const sql = 'SELECT * from parent WHERE id=1'
  const [row] = await adapter.query({ sql })
  t.is(row.value, 'incoming')
  t.is(row.other, 1)

  const localEntries = await satellite._getEntries()
  const shadowEntry = await satellite._getOplogShadowEntry(localEntries[0])

  t.deepEqual(
    encodeTags([
      generateTag(clientId, new Date(localTimestamp)),
      generateTag('remote', new Date(incomingTs)),
    ]),
    shadowEntry[0].tags
  )

  //t.deepEqual(shadowEntries, shadowEntries2)
  t.is(localEntries.length, 1)
})

test('apply incoming with no local', async (t) => {
  const { adapter, runMigrations, satellite, tableInfo, authState } =
    t.context as any
  await runMigrations()

  const incomingTs = new Date()
  const incomingEntry = generateRemoteOplogEntry(
    tableInfo,
    'main',
    'parent',
    OPTYPES.delete,
    incomingTs.getTime(),
    genEncodedTags('remote', []),
    {
      id: 1,
      value: 'incoming',
      otherValue: 1,
    }
  )
  await satellite._setAuthState(authState)
  await satellite._apply([incomingEntry], 'remote')

  const sql = 'SELECT * from parent WHERE id=1'
  const rows = await adapter.query({ sql })
  const shadowEntries = await satellite._getOplogShadowEntry()

  t.is(shadowEntries.length, 0)
  t.is(rows.length, 0)
})

test('apply empty incoming', async (t) => {
  const { runMigrations, satellite, authState } = t.context as ContextType
  await runMigrations()

  await satellite._setAuthState(authState)
  await satellite._apply([])

  t.true(true)
})

test('apply incoming with null on column with default', async (t) => {
  const { runMigrations, satellite, adapter, tableInfo, authState } =
    t.context as any
  await runMigrations()

  const incomingTs = new Date().getTime()
  const incomingEntry = generateRemoteOplogEntry(
    tableInfo,
    'main',
    'parent',
    OPTYPES.insert,
    incomingTs,
    genEncodedTags('remote', [incomingTs]),
    {
      id: 1234,
      value: 'incoming',
      other: null,
    }
  )

  await satellite._setAuthState(authState)

  satellite.relations = relations // satellite must be aware of the relations in order to turn `DataChange`s into `OpLogEntry`s

  const incomingChange = opLogEntryToChange(incomingEntry, relations)
  const incomingTx = {
    origin: 'remote',
    commit_timestamp: Long.fromNumber(incomingTs),
    changes: [incomingChange],
    lsn: new Uint8Array(),
  }
  await satellite._applyTransaction(incomingTx)

  const sql = `SELECT * from main.parent WHERE value='incoming'`
  const rows = await adapter.query({ sql })

  t.is(rows[0].other, null)
  t.pass()
})

test('apply incoming with undefined on column with default', async (t) => {
  const { runMigrations, satellite, adapter, tableInfo, authState } =
    t.context as any
  await runMigrations()

  const incomingTs = new Date().getTime()
  const incomingEntry = generateRemoteOplogEntry(
    tableInfo,
    'main',
    'parent',
    OPTYPES.insert,
    incomingTs,
    genEncodedTags('remote', [incomingTs]),
    {
      id: 1234,
      value: 'incoming',
    }
  )

  await satellite._setAuthState(authState)

  satellite.relations = relations // satellite must be aware of the relations in order to turn `DataChange`s into `OpLogEntry`s

  const incomingChange = opLogEntryToChange(incomingEntry, relations)
  const incomingTx = {
    origin: 'remote',
    commit_timestamp: Long.fromNumber(incomingTs),
    changes: [incomingChange],
    lsn: new Uint8Array(),
  }
  await satellite._applyTransaction(incomingTx)

  const sql = `SELECT * from main.parent WHERE value='incoming'`
  const rows = await adapter.query({ sql })

  t.is(rows[0].other, 0)
  t.pass()
})

test('INSERT wins over DELETE and restored deleted values', async (t) => {
  const { runMigrations, satellite, tableInfo, authState } = t.context as any
  await runMigrations()
  await satellite._setAuthState(authState)
  const clientId = satellite['_authState']['clientId']

  const localTs = new Date().getTime()
  const incomingTs = localTs + 1

  const incoming = [
    generateRemoteOplogEntry(
      tableInfo,
      'main',
      'parent',
      OPTYPES.insert,
      incomingTs,
      genEncodedTags('remote', [incomingTs]),
      {
        id: 1,
        other: 1,
      }
    ),
    generateRemoteOplogEntry(
      tableInfo,
      'main',
      'parent',
      OPTYPES.delete,
      incomingTs,
      genEncodedTags('remote', []),
      {
        id: 1,
      }
    ),
  ]

  const local = [
    generateLocalOplogEntry(
      tableInfo,
      'main',
      'parent',
      OPTYPES.insert,
      localTs,
      genEncodedTags(clientId, [localTs]),
      {
        id: 1,
        value: 'local',
        other: null,
      }
    ),
  ]

  const merged = satellite._mergeEntries(clientId, local, 'remote', incoming)
  const item = merged['main.parent']['1']

  t.deepEqual(item, {
    namespace: 'main',
    tablename: 'parent',
    primaryKeyCols: { id: 1 },
    optype: OPTYPES.upsert,
    changes: {
      id: { value: 1, timestamp: incomingTs },
      value: { value: 'local', timestamp: localTs },
      other: { value: 1, timestamp: incomingTs },
    },
    fullRow: {
      id: 1,
      value: 'local',
      other: 1,
    },
    tags: [
      generateTag(clientId, new Date(localTs)),
      generateTag('remote', new Date(incomingTs)),
    ],
  })
})

test('concurrent updates take all changed values', async (t) => {
  const { runMigrations, satellite, tableInfo, authState } = t.context as any
  await runMigrations()
  await satellite._setAuthState(authState)
  const clientId = satellite['_authState']['clientId']

  const localTs = new Date().getTime()
  const incomingTs = localTs + 1

  const incoming = [
    generateRemoteOplogEntry(
      tableInfo,
      'main',
      'parent',
      OPTYPES.update,
      incomingTs,
      genEncodedTags('remote', [incomingTs]),
      {
        id: 1,
        value: 'remote', // the only modified column
        other: 0,
      },
      {
        id: 1,
        value: 'local',
        other: 0,
      }
    ),
  ]

  const local = [
    generateLocalOplogEntry(
      tableInfo,
      'main',
      'parent',
      OPTYPES.update,
      localTs,
      genEncodedTags(clientId, [localTs]),
      {
        id: 1,
        value: 'local',
        other: 1, // the only modified column
      },
      {
        id: 1,
        value: 'local',
        other: 0,
      }
    ),
  ]

  const merged = satellite._mergeEntries(clientId, local, 'remote', incoming)
  const item = merged['main.parent']['1']

  // The incoming entry modified the value of the `value` column to `'remote'`
  // The local entry concurrently modified the value of the `other` column to 1.
  // The merged entries should have `value = 'remote'` and `other = 1`.
  t.deepEqual(item, {
    namespace: 'main',
    tablename: 'parent',
    primaryKeyCols: { id: 1 },
    optype: OPTYPES.upsert,
    changes: {
      value: { value: 'remote', timestamp: incomingTs },
      other: { value: 1, timestamp: localTs },
    },
    fullRow: {
      id: 1,
      value: 'remote',
      other: 1,
    },
    tags: [
      generateTag(clientId, new Date(localTs)),
      generateTag('remote', new Date(incomingTs)),
    ],
  })
})

test('merge incoming with empty local', async (t) => {
  const { runMigrations, satellite, tableInfo, authState } = t.context as any
  await runMigrations()
  await satellite._setAuthState(authState)
  const clientId = satellite['_authState']['clientId']

  const localTs = new Date().getTime()
  const incomingTs = localTs + 1

  const incoming = [
    generateRemoteOplogEntry(
      tableInfo,
      'main',
      'parent',
      OPTYPES.insert,
      incomingTs,
      genEncodedTags('remote', [incomingTs]),
      {
        id: 1,
      },
      undefined
    ),
  ]

  const local: OplogEntry[] = []
  const merged = satellite._mergeEntries(clientId, local, 'remote', incoming)
  const item = merged['main.parent']['1']

  t.deepEqual(item, {
    namespace: 'main',
    tablename: 'parent',
    primaryKeyCols: { id: 1 },
    optype: OPTYPES.upsert,
    changes: {
      id: { value: 1, timestamp: incomingTs },
    },
    fullRow: {
      id: 1,
    },
    tags: [generateTag('remote', new Date(incomingTs))],
  })
})

test('advance oplog cursor', async (t) => {
  const { adapter, runMigrations, satellite } = t.context as ContextType
  await runMigrations()

  // fake current propagated rowId
  satellite._lastSentRowId = 2

  // Get tablenames.
  const oplogTablename = opts.oplogTable.tablename
  const metaTablename = opts.metaTable.tablename

  // Insert a couple of rows.
  await adapter.run({ sql: `INSERT INTO main.parent(id) VALUES ('1'),('2')` })

  // We have two rows in the oplog.
  let rows = await adapter.query({
    sql: `SELECT count(rowid) as num_rows FROM ${oplogTablename}`,
  })
  t.is(rows[0].num_rows, 2)

  // Ack.
  await satellite._ack(2, true)

  // NOTE: The oplog is not clean! This is a current design decision to clear
  // oplog only when receiving transaction that originated from Satellite in the
  // first place.
  rows = await adapter.query({
    sql: `SELECT count(rowid) as num_rows FROM ${oplogTablename}`,
  })
  t.is(rows[0].num_rows, 2)

  // Verify the meta.
  rows = await adapter.query({
    sql: `SELECT value FROM ${metaTablename} WHERE key = 'lastAckdRowId'`,
  })
  t.is(rows[0].value, '2')
})

test('compensations: referential integrity is enforced', async (t) => {
  const { adapter, runMigrations, satellite } = t.context as ContextType
  await runMigrations()

  await adapter.run({ sql: `PRAGMA foreign_keys = ON` })
  await satellite._setMeta('compensations', 0)
  await adapter.run({
    sql: `INSERT INTO main.parent(id, value) VALUES (1, '1')`,
  })

  await t.throwsAsync(
    adapter.run({ sql: `INSERT INTO main.child(id, parent) VALUES (1, 2)` }),
    {
      code: 'SQLITE_CONSTRAINT_FOREIGNKEY',
    }
  )
})

test('compensations: incoming operation breaks referential integrity', async (t) => {
  const { adapter, runMigrations, satellite, tableInfo, timestamp, authState } =
    t.context as any
  await runMigrations()

  await adapter.run({ sql: `PRAGMA foreign_keys = ON;` })
  await satellite._setMeta('compensations', 0)
  await satellite._setAuthState(authState)

  const incoming = generateLocalOplogEntry(
    tableInfo,
    'main',
    'child',
    OPTYPES.insert,
    timestamp,
    genEncodedTags('remote', [timestamp]),
    {
      id: 1,
      parent: 1,
    }
  )

  // await satellite._setAuthState(authState)

  satellite.relations = relations // satellite must be aware of the relations in order to turn `DataChange`s into `OpLogEntry`s

  const incomingChange = opLogEntryToChange(incoming, relations)
  const incomingTx = {
    origin: 'remote',
    commit_timestamp: Long.fromNumber(timestamp),
    changes: [incomingChange],
    lsn: new Uint8Array(),
  }

  await t.throwsAsync(satellite._applyTransaction(incomingTx), {
    code: 'SQLITE_CONSTRAINT_FOREIGNKEY',
  })
})

test('compensations: incoming operations accepted if restore referential integrity', async (t) => {
  const { adapter, runMigrations, satellite, tableInfo, timestamp, authState } =
    t.context as any
  await runMigrations()

  await adapter.run({ sql: `PRAGMA foreign_keys = ON;` })
  await satellite._setMeta('compensations', 0)
  await satellite._setAuthState(authState)
  const clientId = satellite['_authState']['clientId']

  const childInsertEntry = generateRemoteOplogEntry(
    tableInfo,
    'main',
    'child',
    OPTYPES.insert,
    timestamp,
    genEncodedTags(clientId, [timestamp]),
    {
      id: 1,
      parent: 1,
    }
  )

  const parentInsertEntry = generateRemoteOplogEntry(
    tableInfo,
    'main',
    'parent',
    OPTYPES.insert,
    timestamp,
    genEncodedTags(clientId, [timestamp]),
    {
      id: 1,
    }
  )

  await adapter.run({
    sql: `INSERT INTO main.parent(id, value) VALUES (1, '1')`,
  })
  await adapter.run({ sql: `DELETE FROM main.parent WHERE id=1` })

  await satellite._performSnapshot()

  satellite.relations = relations // satellite must be aware of the relations in order to turn `DataChange`s into `OpLogEntry`s

  const childInsertChange = opLogEntryToChange(childInsertEntry, relations)
  const parentInsertChange = opLogEntryToChange(parentInsertEntry, relations)
  const insertChildAndParentTx = {
    origin: 'remote',
    commit_timestamp: Long.fromNumber(new Date().getTime()), // timestamp is not important for this test, it is only used to GC the oplog
    changes: [childInsertChange, parentInsertChange],
    lsn: new Uint8Array(),
  }
  await satellite._applyTransaction(insertChildAndParentTx)

  const rows = await adapter.query({
    sql: `SELECT * from main.parent WHERE id=1`,
  })

  // Not only does the parent exist.
  t.is(rows.length, 1)

  // But it's also recreated with deleted values.
  t.is(rows[0].value, '1')
})

test('compensations: using triggers with flag 0', async (t) => {
  const { adapter, runMigrations, satellite, tableInfo, authState } =
    t.context as any
  await runMigrations()

  await adapter.run({ sql: `PRAGMA foreign_keys = ON` })
  await satellite._setMeta('compensations', 0)
  satellite._lastSentRowId = 1

  await adapter.run({
    sql: `INSERT INTO main.parent(id, value) VALUES (1, '1')`,
  })
  await satellite._setAuthState(authState)
  await satellite._performSnapshot()
  await satellite._ack(1, true)

  await adapter.run({ sql: `INSERT INTO main.child(id, parent) VALUES (1, 1)` })
  await satellite._performSnapshot()

  const timestamp = new Date().getTime()
  const incoming = generateRemoteOplogEntry(
    tableInfo,
    'main',
    'parent',
    OPTYPES.delete,
    timestamp,
    genEncodedTags('remote', []),
    {
      id: 1,
    }
  )

  satellite.relations = relations // satellite must be aware of the relations in order to turn `DataChange`s into `OpLogEntry`s

  const incomingChange = opLogEntryToChange(incoming, relations)
  const incomingTx = {
    origin: 'remote',
    commit_timestamp: Long.fromNumber(timestamp),
    changes: [incomingChange],
    lsn: new Uint8Array(),
  }

  await t.throwsAsync(satellite._applyTransaction(incomingTx), {
    code: 'SQLITE_CONSTRAINT_FOREIGNKEY',
  })
})

test('compensations: using triggers with flag 1', async (t) => {
  const { adapter, runMigrations, satellite, tableInfo, authState } =
    t.context as ContextType
  await runMigrations()

  await adapter.run({ sql: `PRAGMA foreign_keys = ON` })
  await satellite._setMeta('compensations', 1)
  satellite._lastSentRowId = 1

  await adapter.run({
    sql: `INSERT INTO main.parent(id, value) VALUES (1, '1')`,
  })
  await satellite._setAuthState(authState)
  await satellite._performSnapshot()
  await satellite._ack(1, true)

  await adapter.run({ sql: `INSERT INTO main.child(id, parent) VALUES (1, 1)` })
  await satellite._performSnapshot()

  const timestamp = new Date().getTime()
  const incoming = [
    generateRemoteOplogEntry(
      tableInfo,
      'main',
      'parent',
      OPTYPES.delete,
      timestamp,
      genEncodedTags('remote', []),
      {
        id: 1,
      }
    ),
  ]
  await satellite._apply(incoming)
  t.true(true)
})

test('get oplogEntries from transaction', async (t) => {
  const { runMigrations, satellite } = t.context as ContextType
  await runMigrations()

  const relations = await satellite['_getLocalRelations']()

  const transaction: DataTransaction = {
    lsn: DEFAULT_LOG_POS,
    commit_timestamp: Long.UZERO,
    changes: [
      {
        relation: relations.parent,
        type: DataChangeType.INSERT,
        record: { id: 0 },
        tags: [], // proper values are not relevent here
      },
    ],
  }

  const expected: OplogEntry = {
    namespace: 'main',
    tablename: 'parent',
    optype: 'INSERT',
    newRow: '{"id":0}',
    oldRow: undefined,
    primaryKey: '{"id":0}',
    rowid: -1,
    timestamp: '1970-01-01T00:00:00.000Z',
    clearTags: encodeTags([]),
  }

  const opLog = fromTransaction(transaction, relations)
  t.deepEqual(opLog[0], expected)
})

test('get transactions from opLogEntries', async (t) => {
  const { runMigrations } = t.context as ContextType
  await runMigrations()

  const opLogEntries: OplogEntry[] = [
    {
      namespace: 'public',
      tablename: 'parent',
      optype: 'INSERT',
      newRow: '{"id":0}',
      oldRow: undefined,
      primaryKey: '{"id":0}',
      rowid: 1,
      timestamp: '1970-01-01T00:00:00.000Z',
      clearTags: encodeTags([]),
    },
    {
      namespace: 'public',
      tablename: 'parent',
      optype: 'UPDATE',
      newRow: '{"id":1}',
      oldRow: '{"id":1}',
      primaryKey: '{"id":1}',
      rowid: 2,
      timestamp: '1970-01-01T00:00:00.000Z',
      clearTags: encodeTags([]),
    },
    {
      namespace: 'public',
      tablename: 'parent',
      optype: 'INSERT',
      newRow: '{"id":2}',
      oldRow: undefined,
      primaryKey: '{"id":0}',
      rowid: 3,
      timestamp: '1970-01-01T00:00:01.000Z',
      clearTags: encodeTags([]),
    },
  ]

  const expected = [
    {
      lsn: numberToBytes(2),
      commit_timestamp: Long.UZERO,
      changes: [
        {
          relation: relations.parent,
          type: DataChangeType.INSERT,
          record: { id: 0 },
          oldRecord: undefined,
          tags: [],
        },
        {
          relation: relations.parent,
          type: DataChangeType.UPDATE,
          record: { id: 1 },
          oldRecord: { id: 1 },
          tags: [],
        },
      ],
    },
    {
      lsn: numberToBytes(3),
      commit_timestamp: Long.UZERO.add(1000),
      changes: [
        {
          relation: relations.parent,
          type: DataChangeType.INSERT,
          record: { id: 2 },
          oldRecord: undefined,
          tags: [],
        },
      ],
    },
  ]

  const opLog = toTransactions(opLogEntries, relations)
  t.deepEqual(opLog, expected)
})

test('rowid acks updates meta', async (t) => {
  const { runMigrations, satellite, client, authState } =
    t.context as ContextType
  await runMigrations()
  await satellite.start(authState)

  const lsn1 = numberToBytes(1)
  client['emit']('ack_lsn', lsn1, false)

  const lsn = await satellite['_getMeta']('lastSentRowId')
  t.is(lsn, '1')
})

test('handling connectivity state change stops queueing operations', async (t) => {
  const { runMigrations, satellite, adapter, authState } =
    t.context as ContextType
  await runMigrations()
  await satellite.start(authState)

  adapter.run({
    sql: `INSERT INTO parent(id, value, other) VALUES (1, 'local', 1)`,
  })

  await satellite._performSnapshot()

  const lsn = await satellite._getMeta('lastSentRowId')
  t.is(lsn, '1')

  await new Promise<void>((res) => {
    setTimeout(async () => {
      const lsn = await satellite._getMeta('lastAckdRowId')
      t.is(lsn, '1')
      res()
    }, 100)
  })

  satellite._connectivityStateChange('disconnected')

  adapter.run({
    sql: `INSERT INTO parent(id, value, other) VALUES (2, 'local', 1)`,
  })

  await satellite._performSnapshot()

  const lsn1 = await satellite._getMeta('lastSentRowId')
  t.is(lsn1, '1')

  satellite._connectivityStateChange('connected')

  setTimeout(async () => {
    const lsn2 = await satellite._getMeta('lastSentRowId')
    t.is(lsn2, '2')
  }, 200)
})

test('garbage collection is triggered when transaction from the same origin is replicated', async (t) => {
  const { satellite } = t.context as ContextType
  const { runMigrations, adapter, authState } = t.context as ContextType
  await runMigrations()
  await satellite.start(authState)

  adapter.run({
    sql: `INSERT INTO parent(id, value, other) VALUES (1, 'local', 1);`,
  })
  adapter.run({
    sql: `UPDATE parent SET value = 'local', other = 2 WHERE id = 1;`,
  })

  let lsn = await satellite._getMeta('lastSentRowId')
  t.is(lsn, '0')

  await satellite._performSnapshot()

  lsn = await satellite._getMeta('lastSentRowId')
  t.is(lsn, '2')
  lsn = await satellite._getMeta('lastAckdRowId')

  const old_oplog = await satellite._getEntries()
  let transactions = toTransactions(old_oplog, relations)
  transactions[0].origin = satellite['_authState']['clientId']

  await satellite._applyTransaction(transactions[0])
  const new_oplog = await satellite._getEntries()
  t.deepEqual(new_oplog, [])
})

// stub client and make satellite throw the error with option off/succeed with option on
test('clear database on BEHIND_WINDOW', async (t) => {
  const { satellite } = t.context as ContextType
  const { runMigrations, authState } = t.context as ContextType
  await runMigrations()

  const base64lsn = base64.fromBytes(numberToBytes(MOCK_BEHIND_WINDOW_LSN))
  await satellite._setMeta('lsn', base64lsn)
  try {
    const conn = await satellite.start(authState, { clearOnBehindWindow: true })
    await conn.connectionPromise
    const lsnAfter = await satellite._getMeta('lsn')
    t.not(lsnAfter, base64lsn)
  } catch (e) {
    t.fail('start should not throw')
  }

  // TODO: test clear subscriptions
})

test('throw other replication errors', async (t) => {
  const { satellite } = t.context as ContextType
  const { runMigrations, authState } = t.context as ContextType
  await runMigrations()

  const base64lsn = base64.fromBytes(numberToBytes(MOCK_INVALID_POSITION_LSN))
  await satellite._setMeta('lsn', base64lsn)
  try {
    const conn = await satellite.start(authState)
    await conn.connectionPromise
    t.fail('start should throw')
  } catch (e: any) {
    t.is(e.code, SatelliteErrorCode.INVALID_POSITION)
  }
})

test('apply shape data and persist subscription', async (t) => {
  const { client, satellite, adapter } = t.context as ContextType
  const { runMigrations, authState } = t.context as ContextType
  await runMigrations()

  // relations must be present at subscription delivery
  client.setRelations(relations)

  const conn = await satellite.start(authState)
  await conn.connectionPromise

  const namespace = 'main'
  const tablename = 'parent'
  const qualified = new QualifiedTablename(namespace, tablename).toString()

  const shapeDef: ClientShapeDefinition = {
    selects: [{ tablename }],
  }

  satellite!.relations = relations
  await satellite.subscribe([shapeDef])

  const p = new Promise<void>((res) => {
    client.subscribeToSubscriptionEvents(
      () => {
        // wait for process to apply shape data
        setTimeout(async () => {
          try {
            const row = await adapter.query({
              sql: `SELECT id FROM ${qualified}`,
            })
            t.is(row.length, 1)

            const shadowRows = await adapter.query({
              sql: `SELECT tags FROM _electric_shadow`,
            })
            t.is(shadowRows.length, 1)

            const subsMeta = await satellite._getMeta('subscriptions')
            const subsObj = JSON.parse(subsMeta)
            t.is(Object.keys(subsObj).length, 1)
            res()
          } catch (e) {
            t.fail()
            res()
          }
        }, 10)
      },
      () => undefined
    )
  })
  await p
})

test('a successful second shape request', async (t) => {
  const { client, satellite, adapter } = t.context as ContextType
  const { runMigrations, authState } = t.context as ContextType
  await runMigrations()

  // relations must be present at subscription delivery
  client.setRelations(relations)

  const conn = await satellite.start(authState)
  await conn.connectionPromise

  const tablename = 'child'
  const qualified = new QualifiedTablename('main', tablename).toString()

  const shapeDef1: ClientShapeDefinition = {
    selects: [{ tablename: 'parent' }],
  }
  const shapeDef2: ClientShapeDefinition = {
    selects: [{ tablename: tablename }],
  }

  satellite!.relations = relations
  await satellite.subscribe([shapeDef1])
  await satellite.subscribe([shapeDef2])

  return new Promise<void>((res, rej) => {
    client.subscribeToSubscriptionEvents(
      (data) => {
        // only test after second subscription delivery
        if (data.data[0].relation.table == tablename) {
          setTimeout(async () => {
            try {
              const row = await adapter.query({
                sql: `SELECT id FROM ${qualified}`,
              })
              t.is(row.length, 1)

              const shadowRows = await adapter.query({
                sql: `SELECT tags FROM _electric_shadow`,
              })
              t.is(shadowRows.length, 2)

              const subsMeta = await satellite._getMeta('subscriptions')
              const subsObj = JSON.parse(subsMeta)
              t.is(Object.keys(subsObj).length, 2)
              res()
            } catch (e) {
              rej(e)
            }
          }, 10)
        }
      },
      () => undefined
    )
  })  
})

test('a second shape request error runs garbage collection', async (t) => {
  const { client, satellite, adapter } = t.context as ContextType
  const { runMigrations, authState } = t.context as ContextType
  await runMigrations()

  // relations must be present at subscription delivery
  client.setRelations(relations)

  const conn = await satellite.start(authState)
  await conn.connectionPromise

  const tablename = 'parent'
  const qualified = new QualifiedTablename('main', tablename).toString()

  const shapeDef1: ClientShapeDefinition = {
    selects: [{ tablename: 'parent' }],
  }
  const shapeDef2: ClientShapeDefinition = {
    selects: [{ tablename: 'another' }],
  }

  satellite!.relations = relations
  await satellite.subscribe([shapeDef1])
  await satellite.subscribe([shapeDef2])

  const p = new Promise<void>((res) => {
    client.subscribeToSubscriptionEvents(
      () => undefined,
      () => {
        setTimeout(async () => {
          try {
            const row = await adapter.query({
              sql: `SELECT id FROM ${qualified}`,
            })
            t.is(row.length, 0)

            const shadowRows = await adapter.query({
              sql: `SELECT tags FROM _electric_shadow`,
            })
            t.is(shadowRows.length, 1)

            const subsMeta = await satellite._getMeta('subscriptions')
            const subsObj = JSON.parse(subsMeta)
            t.deepEqual(subsObj, {})
            res()
          } catch (e) {
            t.fail()
            res()
          }
        }, 10)
      }
    )
  })
  await p
})

// TODO: implement reconnect protocol

// test('resume out of window clears subscriptions and clears oplog after ack', async (t) => {})

// test('not possible to subscribe while oplog is not pushed', async (t) => {})

// test('process restart loads previous subscriptions', async (t) => {})
