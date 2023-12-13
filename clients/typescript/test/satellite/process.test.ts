import anyTest, { TestFn } from 'ava'

import {
  MOCK_BEHIND_WINDOW_LSN,
  MOCK_INTERNAL_ERROR,
  MockSatelliteClient,
} from '../../src/satellite/mock'
import { QualifiedTablename } from '../../src/util/tablename'
import { sleepAsync } from '../../src/util/timer'

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
  getMatchingShadowEntries,
} from '../support/satellite-helpers'
import Long from 'long'
import {
  DataChangeType,
  DataTransaction,
  SatelliteError,
  SatelliteErrorCode,
} from '../../src/util/types'
import {
  makeContext,
  opts,
  relations,
  cleanAndStopSatellite,
  ContextType,
} from './common'
import { DEFAULT_LOG_POS, numberToBytes, base64 } from '../../src/util/common'

import {
  ClientShapeDefinition,
  SubscriptionData,
} from '../../src/satellite/shapes/types'
import { mergeEntries } from '../../src/satellite/merge'

const parentRecord = {
  id: 1,
  value: 'incoming',
  other: 1,
}

const childRecord = {
  id: 1,
  parent: 1,
}

const test = anyTest as TestFn<ContextType>
test.beforeEach(makeContext)
test.afterEach.always(cleanAndStopSatellite)

test('setup starts a satellite process', async (t) => {
  t.true(t.context.satellite instanceof SatelliteProcess)
})

test('start creates system tables', async (t) => {
  const { adapter, satellite, authState } = t.context

  await satellite.start(authState)

  const sql = "select name from sqlite_master where type = 'table'"
  const rows = await adapter.query({ sql })
  const names = rows.map((row) => row.name)

  t.true(names.includes('_electric_oplog'))
})

test('load metadata', async (t) => {
  const { adapter, runMigrations } = t.context
  await runMigrations()

  const meta = await loadSatelliteMetaTable(adapter)
  t.deepEqual(meta, {
    compensations: 1,
    lsn: '',
    clientId: '',
    subscriptions: '',
  })
})

test('set persistent client id', async (t) => {
  const { satellite, authState } = t.context

  await satellite.start(authState)
  const clientId1 = satellite._authState!.clientId
  t.truthy(clientId1)
  await satellite.stop()

  await satellite.start(authState)

  const clientId2 = satellite._authState!.clientId
  t.truthy(clientId2)
  t.assert(clientId1 === clientId2)
})

test('cannot UPDATE primary key', async (t) => {
  const { adapter, runMigrations } = t.context
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
  const { satellite } = t.context
  const { adapter, notifier, runMigrations, authState } = t.context
  await runMigrations()
  await satellite._setAuthState(authState)

  await adapter.run({ sql: `INSERT INTO parent(id) VALUES ('1'),('2')` })

  let snapshotTimestamp = await satellite._performSnapshot()

  const clientId = satellite._authState!.clientId
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

test('(regression) performSnapshot cant be called concurrently', async (t) => {
  const { authState, satellite, runMigrations } = t.context
  await runMigrations()
  await satellite._setAuthState(authState)

  await t.throwsAsync(
    async () => {
      const run = satellite.adapter.run.bind(satellite.adapter)
      satellite.adapter.run = (stmt) =>
        new Promise((res) => setTimeout(() => run(stmt).then(res), 100))

      const p1 = satellite._performSnapshot()
      const p2 = satellite._performSnapshot()
      await Promise.all([p1, p2])
    },
    {
      instanceOf: SatelliteError,
      code: SatelliteErrorCode.INTERNAL,
      message: 'already performing snapshot',
    }
  )
})

test('(regression) throttle with mutex prevents race when snapshot is slow', async (t) => {
  const { authState, satellite, runMigrations } = t.context
  await runMigrations()
  await satellite._setAuthState(authState)

  // delay termination of _performSnapshot
  const run = satellite.adapter.run.bind(satellite.adapter)
  satellite.adapter.run = (stmt) =>
    new Promise((res) => setTimeout(() => run(stmt).then(res), 100))

  const p1 = satellite._throttledSnapshot()
  const p2 = new Promise<Date>((res) => {
    // call snapshot after throttle time has expired
    setTimeout(() => satellite._throttledSnapshot()?.then(res), 50)
  })

  await t.notThrowsAsync(async () => {
    await p1
    await p2
  })
})

test('starting and stopping the process works', async (t) => {
  const { adapter, notifier, runMigrations, satellite, authState } = t.context
  await runMigrations()

  await adapter.run({ sql: `INSERT INTO parent(id) VALUES ('1'),('2')` })

  const conn = await satellite.start(authState)
  await conn.connectionPromise

  await sleepAsync(opts.pollingInterval)

  // connect, 1st txn
  t.is(notifier.notifications.length, 2)

  await adapter.run({ sql: `INSERT INTO parent(id) VALUES ('3'),('4')` })
  await sleepAsync(opts.pollingInterval)

  // 2nd txm
  t.is(notifier.notifications.length, 3)

  await satellite.stop()
  await adapter.run({ sql: `INSERT INTO parent(id) VALUES ('5'),('6')` })
  await sleepAsync(opts.pollingInterval)

  // no txn notified
  t.is(notifier.notifications.length, 4)

  const conn1 = await satellite.start(authState)
  await conn1.connectionPromise
  await sleepAsync(opts.pollingInterval)

  // connect, 4th txn
  t.is(notifier.notifications.length, 6)
})

test('snapshots on potential data change', async (t) => {
  const { adapter, notifier, runMigrations } = t.context
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
  const { adapter, runMigrations, satellite, authState } = t.context

  await runMigrations()

  await adapter.run({
    sql: `INSERT INTO parent(id, value) VALUES (1,'val1')`,
  })
  await adapter.run({ sql: `DELETE FROM parent WHERE id=1` })
  await adapter.run({ sql: `INSERT INTO parent(id) VALUES (1)` })

  await satellite._setAuthState(authState)
  await satellite._performSnapshot()
  const entries = await satellite._getEntries()
  const clientId = satellite._authState!.clientId

  const merged = localOperationsToTableChanges(
    entries,
    (timestamp: Date) => {
      return generateTag(clientId, timestamp)
    },
    relations
  )
  const [_, keyChanges] = merged['main.parent']['{"id":1}']
  const resultingValue = keyChanges.changes.value.value
  t.is(resultingValue, null)
})

test('snapshot of INSERT with bigint', async (t) => {
  const { adapter, runMigrations, satellite, authState } = t.context

  await runMigrations()

  await adapter.run({
    sql: `INSERT INTO bigIntTable(value) VALUES (1)`,
  })

  await satellite._setAuthState(authState)
  await satellite._performSnapshot()
  const entries = await satellite._getEntries()
  const clientId = satellite._authState!.clientId

  const merged = localOperationsToTableChanges(
    entries,
    (timestamp: Date) => {
      return generateTag(clientId, timestamp)
    },
    relations
  )
  const [_, keyChanges] = merged['main.bigIntTable']['{"value":"1"}']
  const resultingValue = keyChanges.changes.value.value
  t.is(resultingValue, 1n)
})

test('take snapshot and merge local wins', async (t) => {
  const { adapter, runMigrations, satellite, tableInfo, authState } = t.context
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
  const clientId = satellite._authState!.clientId

  const local = await satellite._getEntries()
  const localTimestamp = new Date(local[0].timestamp).getTime()
  const merged = mergeEntries(
    clientId,
    local,
    'remote',
    [incomingEntry],
    relations
  )
  const item = merged['main.parent']['{"id":1}']

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
  const { adapter, runMigrations, satellite, tableInfo, authState } = t.context
  await runMigrations()

  await adapter.run({
    sql: `INSERT INTO parent(id, value, other) VALUES (1, 'local', 1)`,
  })

  await satellite._setAuthState(authState)
  const clientId = satellite._authState!.clientId
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

  const merged = mergeEntries(
    clientId,
    local,
    'remote',
    [incomingEntry],
    relations
  )
  const item = merged['main.parent']['{"id":1}']

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

test('merge incoming wins on persisted ops', async (t) => {
  const { adapter, runMigrations, satellite, tableInfo, authState } = t.context
  await runMigrations()
  await satellite._setAuthState(authState)
  satellite.relations = relations

  // This operation is persisted
  await adapter.run({
    sql: `INSERT INTO parent(id, value, other) VALUES (1, 'local', 1)`,
  })
  await satellite._performSnapshot()
  const [originalInsert] = await satellite._getEntries()
  const [tx] = toTransactions([originalInsert], satellite.relations)
  tx.origin = authState.clientId
  await satellite._applyTransaction(tx)

  // Verify that GC worked as intended and the oplog entry was deleted
  t.deepEqual(await satellite._getEntries(), [])

  // This operation is done offline
  await adapter.run({
    sql: `UPDATE parent SET value = 'new local' WHERE id = 1`,
  })
  await satellite._performSnapshot()
  const [offlineInsert] = await satellite._getEntries()
  const offlineTimestamp = new Date(offlineInsert.timestamp).getTime()

  // This operation is done concurrently with offline but at a later point in time. It's sent immediately on connection
  const incomingTs = offlineTimestamp + 1
  const firstIncomingEntry = generateRemoteOplogEntry(
    tableInfo,
    'main',
    'parent',
    OPTYPES.update,
    incomingTs,
    genEncodedTags('remote', [incomingTs]),
    { id: 1, value: 'incoming' },
    { id: 1, value: 'local' }
  )

  const firstIncomingTx = {
    origin: 'remote',
    commit_timestamp: Long.fromNumber(incomingTs),
    changes: [opLogEntryToChange(firstIncomingEntry, satellite.relations)],
    lsn: new Uint8Array(),
  }
  await satellite._applyTransaction(firstIncomingTx)

  const [{ value: value1 }] = await adapter.query({
    sql: 'SELECT value FROM parent WHERE id = 1',
  })
  t.is(
    value1,
    'incoming',
    'LWW conflict merge of the incoming transaction should lead to incoming operation winning'
  )

  // And after the offline transaction was sent, the resolved no-op transaction comes in
  const secondIncomingEntry = generateRemoteOplogEntry(
    tableInfo,
    'main',
    'parent',
    OPTYPES.update,
    offlineTimestamp,
    encodeTags([
      generateTag('remote', incomingTs),
      generateTag(authState.clientId, offlineTimestamp),
    ]),
    { id: 1, value: 'incoming' },
    { id: 1, value: 'incoming' }
  )

  const secondIncomingTx = {
    origin: authState.clientId,
    commit_timestamp: Long.fromNumber(offlineTimestamp),
    changes: [opLogEntryToChange(secondIncomingEntry, satellite.relations)],
    lsn: new Uint8Array(),
  }
  await satellite._applyTransaction(secondIncomingTx)

  const [{ value: value2 }] = await adapter.query({
    sql: 'SELECT value FROM parent WHERE id = 1',
  })
  t.is(
    value2,
    'incoming',
    'Applying the resolved write from the round trip should be a no-op'
  )
})

test('apply does not add anything to oplog', async (t) => {
  const { adapter, runMigrations, satellite, tableInfo, authState } = t.context
  await runMigrations()
  await adapter.run({
    sql: `INSERT INTO parent(id, value, other) VALUES (1, 'local', null)`,
  })

  await satellite._setAuthState(authState)
  const clientId = satellite._authState!.clientId

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
  const shadowEntry = await getMatchingShadowEntries(adapter, localEntries[0])

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
  const { adapter, runMigrations, satellite, tableInfo, authState } = t.context
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

  satellite.relations = relations // satellite must be aware of the relations in order to deserialise oplog entries

  await satellite._setAuthState(authState)
  await satellite._apply([incomingEntry], 'remote')

  const sql = 'SELECT * from parent WHERE id=1'
  const rows = await adapter.query({ sql })
  const shadowEntries = await getMatchingShadowEntries(adapter)

  t.is(shadowEntries.length, 0)
  t.is(rows.length, 0)
})

test('apply empty incoming', async (t) => {
  const { runMigrations, satellite, authState } = t.context
  await runMigrations()

  await satellite._setAuthState(authState)
  await satellite._apply([], 'external')

  t.true(true)
})

test('apply incoming with null on column with default', async (t) => {
  const { runMigrations, satellite, adapter, tableInfo, authState } = t.context
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
  const { runMigrations, satellite, adapter, tableInfo, authState } = t.context
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
  const { runMigrations, satellite, tableInfo, authState } = t.context
  await runMigrations()
  await satellite._setAuthState(authState)
  const clientId = satellite._authState!.clientId

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

  const merged = mergeEntries(clientId, local, 'remote', incoming, relations)
  const item = merged['main.parent']['{"id":1}']

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
  const { runMigrations, satellite, tableInfo, authState } = t.context
  await runMigrations()
  await satellite._setAuthState(authState)
  const clientId = satellite._authState!.clientId

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

  const merged = mergeEntries(clientId, local, 'remote', incoming, relations)
  const item = merged['main.parent']['{"id":1}']

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
  const { runMigrations, satellite, tableInfo, authState } = t.context
  await runMigrations()
  await satellite._setAuthState(authState)
  const clientId = satellite._authState!.clientId

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
  const merged = mergeEntries(clientId, local, 'remote', incoming, relations)
  const item = merged['main.parent']['{"id":1}']

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

test('compensations: referential integrity is enforced', async (t) => {
  const { adapter, runMigrations, satellite } = t.context
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
    t.context
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
    t.context
  await runMigrations()

  await adapter.run({ sql: `PRAGMA foreign_keys = ON;` })
  await satellite._setMeta('compensations', 0)
  await satellite._setAuthState(authState)
  const clientId = satellite._authState!.clientId

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
  const { adapter, runMigrations, satellite, tableInfo, authState } = t.context
  await runMigrations()

  await adapter.run({ sql: `PRAGMA foreign_keys = ON` })
  await satellite._setMeta('compensations', 0)

  await adapter.run({
    sql: `INSERT INTO main.parent(id, value) VALUES (1, '1')`,
  })
  await satellite._setAuthState(authState)
  const ts = await satellite._performSnapshot()
  await satellite._garbageCollectOplog(ts)

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
  const { adapter, runMigrations, satellite, tableInfo, authState } = t.context
  await runMigrations()

  await adapter.run({ sql: `PRAGMA foreign_keys = ON` })
  await satellite._setMeta('compensations', 1)

  await adapter.run({
    sql: `INSERT INTO main.parent(id, value) VALUES (1, '1')`,
  })
  await satellite._setAuthState(authState)
  const ts = await satellite._performSnapshot()
  await satellite._garbageCollectOplog(ts)

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

  satellite.relations = relations // satellite must be aware of the relations in order to deserialise oplog entries

  await satellite._apply(incoming, 'remote')
  t.pass()
})

test('get oplogEntries from transaction', async (t) => {
  const { runMigrations, satellite } = t.context
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
  const { runMigrations } = t.context
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

test('handling connectivity state change stops queueing operations', async (t) => {
  const { runMigrations, satellite, adapter, authState } = t.context
  await runMigrations()
  await satellite.start(authState)

  adapter.run({
    sql: `INSERT INTO parent(id, value, other) VALUES (1, 'local', 1)`,
  })

  await satellite._performSnapshot()

  // We should have sent (or at least enqueued to send) one row
  const sentLsn = satellite.client.getLastSentLsn()
  t.deepEqual(sentLsn, numberToBytes(1))

  await satellite._handleConnectivityStateChange('disconnected')

  adapter.run({
    sql: `INSERT INTO parent(id, value, other) VALUES (2, 'local', 1)`,
  })

  await satellite._performSnapshot()

  // Since connectivity is down, that row isn't yet sent
  const lsn1 = satellite.client.getLastSentLsn()
  t.deepEqual(lsn1, sentLsn)

  // Once connectivity is restored, we will immediately run a snapshot to send pending rows
  await satellite._handleConnectivityStateChange('available')
  await sleepAsync(200) // Wait for snapshot to run
  const lsn2 = satellite.client.getLastSentLsn()
  t.deepEqual(lsn2, numberToBytes(2))
})

test('garbage collection is triggered when transaction from the same origin is replicated', async (t) => {
  const { satellite } = t.context
  const { runMigrations, adapter, authState } = t.context
  await runMigrations()
  await satellite.start(authState)

  adapter.run({
    sql: `INSERT INTO parent(id, value, other) VALUES (1, 'local', 1);`,
  })
  adapter.run({
    sql: `UPDATE parent SET value = 'local', other = 2 WHERE id = 1;`,
  })

  // Before snapshot, we didn't send anything
  const lsn1 = satellite.client.getLastSentLsn()
  t.deepEqual(lsn1, numberToBytes(0))

  // Snapshot sends these oplog entries
  await satellite._performSnapshot()
  const lsn2 = satellite.client.getLastSentLsn()
  t.deepEqual(lsn2, numberToBytes(2))

  const old_oplog = await satellite._getEntries()
  const transactions = toTransactions(old_oplog, relations)
  transactions[0].origin = satellite._authState!.clientId

  // Transaction containing these oplogs is applies, which means we delete them
  await satellite._applyTransaction(transactions[0])
  const new_oplog = await satellite._getEntries()
  t.deepEqual(new_oplog, [])
})

// stub client and make satellite throw the error with option off/succeed with option on
test('clear database on BEHIND_WINDOW', async (t) => {
  const { satellite } = t.context
  const { runMigrations, authState } = t.context
  await runMigrations()

  const base64lsn = base64.fromBytes(numberToBytes(MOCK_BEHIND_WINDOW_LSN))
  await satellite._setMeta('lsn', base64lsn)
  try {
    const conn = await satellite.start(authState)
    await conn.connectionPromise
    const lsnAfter = await satellite._getMeta('lsn')
    t.not(lsnAfter, base64lsn)
  } catch (e) {
    t.fail('start should not throw')
  }

  // TODO: test clear subscriptions
})

test('throw other replication errors', async (t) => {
  t.plan(2)
  const { satellite } = t.context
  const { runMigrations, authState } = t.context
  await runMigrations()

  const base64lsn = base64.fromBytes(numberToBytes(MOCK_INTERNAL_ERROR))
  await satellite._setMeta('lsn', base64lsn)

  const conn = await satellite.start(authState)
  return Promise.all(
    [satellite['initializing']?.waitOn(), conn.connectionPromise].map((p) =>
      p?.catch((e: SatelliteError) => {
        t.is(e.code, SatelliteErrorCode.INTERNAL)
      })
    )
  )
})

test('apply shape data and persist subscription', async (t) => {
  const { client, satellite, adapter, notifier } = t.context
  const { runMigrations, authState } = t.context
  await runMigrations()

  const namespace = 'main'
  const tablename = 'parent'
  const qualified = new QualifiedTablename(namespace, tablename)

  // relations must be present at subscription delivery
  client.setRelations(relations)
  client.setRelationData(tablename, parentRecord)

  const conn = await satellite.start(authState)
  await conn.connectionPromise

  const shapeDef: ClientShapeDefinition = {
    selects: [{ tablename }],
  }

  satellite!.relations = relations
  const { synced } = await satellite.subscribe([shapeDef])
  await synced

  // first notification is 'connected'
  t.is(notifier.notifications.length, 2)
  t.is(notifier.notifications[1].changes.length, 1)
  t.deepEqual(notifier.notifications[1].changes[0], {
    qualifiedTablename: qualified,
    rowids: [],
  })

  // wait for process to apply shape data
  try {
    const row = await adapter.query({
      sql: `SELECT id FROM ${qualified.toString()}`,
    })
    t.is(row.length, 1)

    const shadowRows = await adapter.query({
      sql: `SELECT tags FROM _electric_shadow`,
    })
    t.is(shadowRows.length, 1)

    const subsMeta = await satellite._getMeta('subscriptions')
    const subsObj = JSON.parse(subsMeta)
    t.is(Object.keys(subsObj).length, 1)

    // Check that we save the LSN sent by the mock
    t.deepEqual(satellite._lsn, base64.toBytes('MTIz'))
  } catch (e) {
    t.fail(JSON.stringify(e))
  }
})

test('(regression) shape subscription succeeds even if subscription data is delivered before the SatSubsReq RPC call receives its SatSubsResp answer', async (t) => {
  const { client, satellite } = t.context
  const { runMigrations, authState } = t.context
  await runMigrations()

  const tablename = 'parent'

  // relations must be present at subscription delivery
  client.setRelations(relations)
  client.setRelationData(tablename, parentRecord)

  const conn = await satellite.start(authState)
  await conn.connectionPromise

  const shapeDef: ClientShapeDefinition = {
    selects: [{ tablename }],
  }

  satellite!.relations = relations

  // Enable the deliver first flag in the mock client
  // such that the subscription data is delivered before the
  // subscription promise is resolved
  const mockClient = satellite.client as MockSatelliteClient
  mockClient.enableDeliverFirst()

  const { synced } = await satellite.subscribe([shapeDef])
  await synced

  t.pass()
})

test('multiple subscriptions for the same shape are deduplicated', async (t) => {
  const { client, satellite } = t.context
  const { runMigrations, authState } = t.context
  await runMigrations()

  const tablename = 'parent'

  // relations must be present at subscription delivery
  client.setRelations(relations)
  client.setRelationData(tablename, parentRecord)

  const conn = await satellite.start(authState)
  await conn.connectionPromise

  const shapeDef: ClientShapeDefinition = {
    selects: [{ tablename }],
  }

  satellite!.relations = relations

  // We want none of these cases to throw
  await t.notThrowsAsync(async () => {
    // We should dedupe subscriptions that are done at the same time
    const [sub1, sub2] = await Promise.all([
      satellite.subscribe([shapeDef]),
      satellite.subscribe([shapeDef]),
    ])
    // That are done after first await but before the data
    const sub3 = await satellite.subscribe([shapeDef])
    // And that are done after previous data is resolved
    await Promise.all([sub1.synced, sub2.synced, sub3.synced])
    const sub4 = await satellite.subscribe([shapeDef])

    await sub4.synced
  })

  // And be "merged" into one subscription
  t.is(satellite.subscriptions.getFulfilledSubscriptions().length, 1)
})

test('applied shape data will be acted upon correctly', async (t) => {
  const { client, satellite, adapter } = t.context
  const { runMigrations, authState } = t.context
  await runMigrations()

  const namespace = 'main'
  const tablename = 'parent'
  const qualified = new QualifiedTablename(namespace, tablename).toString()

  // relations must be present at subscription delivery
  client.setRelations(relations)
  client.setRelationData(tablename, parentRecord)

  const conn = await satellite.start(authState)
  await conn.connectionPromise

  const shapeDef: ClientShapeDefinition = {
    selects: [{ tablename }],
  }

  satellite!.relations = relations
  const { synced } = await satellite.subscribe([shapeDef])
  await synced

  // wait for process to apply shape data
  try {
    const row = await adapter.query({
      sql: `SELECT id FROM ${qualified}`,
    })
    t.is(row.length, 1)

    const shadowRows = await adapter.query({
      sql: `SELECT * FROM _electric_shadow`,
    })
    t.is(shadowRows.length, 1)
    t.like(shadowRows[0], {
      namespace: 'main',
      tablename: 'parent',
    })

    await adapter.run({ sql: `DELETE FROM ${qualified} WHERE id = 1` })
    await satellite._performSnapshot()

    const oplogs = await adapter.query({
      sql: `SELECT * FROM _electric_oplog`,
    })
    t.not(oplogs[0].clearTags, '[]')
  } catch (e) {
    t.fail(JSON.stringify(e))
  }
})

test('a subscription that failed to apply because of FK constraint triggers GC', async (t) => {
  const { client, satellite, adapter } = t.context
  const { runMigrations, authState } = t.context
  await runMigrations()

  const tablename = 'child'
  const namespace = 'main'
  const qualified = new QualifiedTablename(namespace, tablename).toString()

  // relations must be present at subscription delivery
  client.setRelations(relations)
  client.setRelationData(tablename, childRecord)

  const conn = await satellite.start(authState)
  await conn.connectionPromise

  const shapeDef1: ClientShapeDefinition = {
    selects: [{ tablename }],
  }

  satellite!.relations = relations
  const { synced } = await satellite.subscribe([shapeDef1])
  await synced // wait for subscription to be fulfilled

  try {
    const row = await adapter.query({
      sql: `SELECT id FROM ${qualified}`,
    })
    t.is(row.length, 0)
  } catch (e) {
    t.fail(JSON.stringify(e))
  }
})

test('a second successful subscription', async (t) => {
  const { client, satellite, adapter } = t.context
  const { runMigrations, authState } = t.context
  await runMigrations()

  const tablename = 'child'
  const qualified = new QualifiedTablename('main', tablename).toString()

  // relations must be present at subscription delivery
  client.setRelations(relations)
  client.setRelationData('parent', parentRecord)
  client.setRelationData(tablename, childRecord)

  const conn = await satellite.start(authState)
  await conn.connectionPromise

  const shapeDef1: ClientShapeDefinition = {
    selects: [{ tablename: 'parent' }],
  }
  const shapeDef2: ClientShapeDefinition = {
    selects: [{ tablename: tablename }],
  }

  satellite!.relations = relations
  await satellite.subscribe([shapeDef1])
  const { synced } = await satellite.subscribe([shapeDef2])
  await synced

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
  } catch (e) {
    t.fail(JSON.stringify(e))
  }
})

test('a single subscribe with multiple tables with FKs', async (t) => {
  const { client, satellite, adapter } = t.context
  const { runMigrations, authState } = t.context
  await runMigrations()

  const qualifiedChild = new QualifiedTablename('main', 'child').toString()

  // relations must be present at subscription delivery
  client.setRelations(relations)
  client.setRelationData('parent', parentRecord)
  client.setRelationData('child', childRecord)

  const conn = await satellite.start(authState)
  await conn.connectionPromise

  const shapeDef1: ClientShapeDefinition = {
    selects: [{ tablename: 'child' }],
  }
  const shapeDef2: ClientShapeDefinition = {
    selects: [{ tablename: 'parent' }],
  }

  satellite!.relations = relations

  const prom = new Promise<void>((res, rej) => {
    client.subscribeToSubscriptionEvents(
      (data: SubscriptionData) => {
        // child is applied first
        t.is(data.data[0].relation.table, 'child')
        t.is(data.data[1].relation.table, 'parent')

        setTimeout(async () => {
          try {
            const row = await adapter.query({
              sql: `SELECT id FROM ${qualifiedChild}`,
            })
            t.is(row.length, 1)

            res()
          } catch (e) {
            rej(e)
          }
        }, 10)
      },
      () => undefined
    )
  })

  await satellite.subscribe([shapeDef1, shapeDef2])

  return prom
})

test.serial('a shape delivery that triggers garbage collection', async (t) => {
  const { client, satellite, adapter } = t.context
  const { runMigrations, authState } = t.context
  await runMigrations()

  const tablename = 'parent'
  const qualified = new QualifiedTablename('main', tablename).toString()

  // relations must be present at subscription delivery
  client.setRelations(relations)
  client.setRelationData(tablename, parentRecord)
  client.setRelationData('another', {})

  const conn = await satellite.start(authState)
  await conn.connectionPromise

  const shapeDef1: ClientShapeDefinition = {
    selects: [{ tablename: 'parent' }],
  }
  const shapeDef2: ClientShapeDefinition = {
    selects: [{ tablename: 'another' }],
  }

  satellite!.relations = relations
  const { synced: synced1 } = await satellite.subscribe([shapeDef1])
  await synced1
  const { synced } = await satellite.subscribe([shapeDef2])

  try {
    await synced
    t.fail()
  } catch (expected: any) {
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
      t.true(expected.message.search("table 'another'") >= 0)
    } catch (e) {
      t.fail(JSON.stringify(e))
    }
  }
})

test('a subscription request failure does not clear the manager state', async (t) => {
  const { client, satellite, adapter } = t.context
  const { runMigrations, authState } = t.context
  await runMigrations()

  // relations must be present at subscription delivery
  const tablename = 'parent'
  const qualified = new QualifiedTablename('main', tablename).toString()
  client.setRelations(relations)
  client.setRelationData(tablename, parentRecord)

  const conn = await satellite.start(authState)
  await conn.connectionPromise

  const shapeDef1: ClientShapeDefinition = {
    selects: [{ tablename: tablename }],
  }

  const shapeDef2: ClientShapeDefinition = {
    selects: [{ tablename: 'failure' }],
  }

  satellite!.relations = relations
  const { synced } = await satellite.subscribe([shapeDef1])
  await synced

  try {
    const row = await adapter.query({
      sql: `SELECT id FROM ${qualified}`,
    })
    t.is(row.length, 1)
  } catch (e) {
    t.fail(JSON.stringify(e))
  }

  try {
    await satellite.subscribe([shapeDef2])
  } catch (error: any) {
    t.is(error.code, SatelliteErrorCode.TABLE_NOT_FOUND)
  }
})

test("Garbage collecting the subscription doesn't generate oplog entries", async (t) => {
  const { adapter, runMigrations, satellite, authState } = t.context
  await satellite.start(authState)
  await runMigrations()
  await adapter.run({ sql: `INSERT INTO parent(id) VALUES ('1'),('2')` })
  const ts = await satellite._performSnapshot()
  await satellite._garbageCollectOplog(ts)
  t.is((await satellite._getEntries(0)).length, 0)

  satellite._garbageCollectShapeHandler([
    { uuid: '', definition: { selects: [{ tablename: 'parent' }] } },
  ])

  await satellite._performSnapshot()
  t.deepEqual(await satellite._getEntries(0), [])
})

test('snapshots: generated oplog entries have the correct tags', async (t) => {
  const { client, satellite, adapter, tableInfo } = t.context
  const { runMigrations, authState } = t.context
  await runMigrations()

  const namespace = 'main'
  const tablename = 'parent'
  const qualified = new QualifiedTablename(namespace, tablename).toString()

  // relations must be present at subscription delivery
  client.setRelations(relations)
  client.setRelationData(tablename, parentRecord)

  const conn = await satellite.start(authState)
  await conn.connectionPromise

  const shapeDef: ClientShapeDefinition = {
    selects: [{ tablename }],
  }

  satellite!.relations = relations
  const { synced } = await satellite.subscribe([shapeDef])
  await synced

  const expectedTs = new Date().getTime()
  const incoming = generateRemoteOplogEntry(
    tableInfo,
    'main',
    'parent',
    OPTYPES.insert,
    expectedTs,
    genEncodedTags('remote', [expectedTs]),
    {
      id: 2,
    }
  )
  const incomingChange = opLogEntryToChange(incoming, relations)

  await satellite._applyTransaction({
    origin: 'remote',
    commit_timestamp: Long.fromNumber(expectedTs),
    changes: [incomingChange],
    lsn: new Uint8Array(),
  })

  const row = await adapter.query({
    sql: `SELECT id FROM ${qualified}`,
  })
  t.is(row.length, 2)

  const shadowRows = await adapter.query({
    sql: `SELECT * FROM _electric_shadow`,
  })
  t.is(shadowRows.length, 2)
  t.like(shadowRows[0], {
    namespace: 'main',
    tablename: 'parent',
  })

  await adapter.run({ sql: `DELETE FROM ${qualified} WHERE id = 2` })
  await satellite._performSnapshot()

  const oplogs = await adapter.query({
    sql: `SELECT * FROM _electric_oplog`,
  })
  t.is(oplogs[0].clearTags, genEncodedTags('remote', [expectedTs]))
})

test('DELETE after DELETE sends clearTags', async (t) => {
  const { adapter, runMigrations, satellite, authState } = t.context
  await runMigrations()

  await satellite._setAuthState(authState)

  await adapter.run({
    sql: `INSERT INTO parent(id, value) VALUES (1,'val1')`,
  })
  await adapter.run({
    sql: `INSERT INTO parent(id, value) VALUES (2,'val2')`,
  })

  await adapter.run({ sql: `DELETE FROM parent WHERE id=1` })

  await satellite._performSnapshot()

  await adapter.run({ sql: `DELETE FROM parent WHERE id=2` })

  await satellite._performSnapshot()

  const entries = await satellite._getEntries()

  t.is(entries.length, 4)

  const delete1 = entries[2]
  const delete2 = entries[3]

  t.is(delete1.primaryKey, '{"id":1}')
  t.is(delete1.optype, 'DELETE')
  // No tags for first delete
  t.is(delete1.clearTags, '[]')

  t.is(delete2.primaryKey, '{"id":2}')
  t.is(delete2.optype, 'DELETE')
  // The second should have clearTags
  t.not(delete2.clearTags, '[]')
})

test.serial('connection backoff success', async (t) => {
  t.plan(3)
  const { client, satellite } = t.context

  client.disconnect()

  const retry = (_e: any, a: number) => {
    if (a > 0) {
      t.pass()
      return false
    }
    return true
  }

  satellite['_connectRetryHandler'] = retry

  await Promise.all(
    [satellite._connectWithBackoff(), satellite['initializing']?.waitOn()].map(
      (p) => p?.catch(() => t.pass())
    )
  )
})

// check that performing snapshot doesn't throw without resetting the performing snapshot assertions
test('(regression) performSnapshot handles exceptions gracefully', async (t) => {
  const { adapter, runMigrations, satellite, authState } = t.context
  await runMigrations()
  await satellite._setAuthState(authState)

  const error = 'FAKE TRANSACTION'

  const txnFn = adapter.transaction
  adapter.transaction = () => {
    throw new Error(error)
  }

  try {
    await satellite._performSnapshot()
  } catch (e: any) {
    t.is(e.message, error)
    adapter.transaction = txnFn
  }

  await satellite._performSnapshot()
  t.pass()
})
