import { mkdir, rm as removeFile } from 'node:fs/promises'

import test from 'ava'

import Database from 'better-sqlite3'
import { DatabaseAdapter } from '../../src/drivers/better-sqlite3/adapter'

import { MockSatelliteClient } from '../../src/satellite/mock'
import { BundleMigrator } from '../../src/migrators/bundle'
import { MockNotifier } from '../../src/notifiers/mock'
import { randomValue } from '../../src/util/random'
import { QualifiedTablename } from '../../src/util/tablename'
import { sleepAsync } from '../../src/util/timer'

import { OPTYPES, operationsToTableChanges, fromTransaction, OplogEntry, toTransactions } from '../../src/satellite/oplog'
import { satelliteDefaults } from '../../src/satellite/config'
import { SatelliteProcess } from '../../src/satellite/process'

import { initTableInfo, loadSatelliteMetaTable, generateOplogEntry, TableInfo } from '../support/satellite-helpers'
import Long from 'long'
import { ChangeType, ConnectivityState, LSN, SqlValue, Transaction } from '../../src/util/types'
import { relations } from './common'
import { Satellite } from '../../src/satellite'
import { DEFAULT_LOG_POS, numberToBytes } from '../../src/util/common'

import { data as testMigrationsData } from '../support/migrations'
import { EventNotifier } from '../../src/notifiers'
const { migrations } = testMigrationsData

interface TestNotifier extends EventNotifier {
  notifications: any[]
}

interface TestSatellite extends Satellite {
  _lastSentRowId: number

  _performSnapshot(): Promise<void>
  _apply(incoming: OplogEntry[], lsn?: LSN): Promise<void>
  _setMeta(key: string, value: SqlValue): Promise<void>
  _getMeta(key: string): Promise<string>
  _ack(lsn: number, isAck: boolean): Promise<void>
  _connectivityStateChange(status: ConnectivityState): void

}

type ContextType = {
  adapter: DatabaseAdapter,
  notifier: TestNotifier
  satellite: TestSatellite,
  client: MockSatelliteClient
  runMigrations: () => Promise<void>
  tableInfo: TableInfo
}

// Speed up the intervals for testing.
const opts = Object.assign({}, satelliteDefaults, {
  minSnapshotWindow: 40,
  pollingInterval: 200
})

test.beforeEach(async t => {
  await mkdir(".tmp", {recursive: true})
  const dbName = `.tmp/test-${randomValue()}.db`
  const db = new Database(dbName)
  const adapter = new DatabaseAdapter(db)
  const migrator = new BundleMigrator(adapter, migrations)
  const notifier = new MockNotifier(dbName)
  const client = new MockSatelliteClient()
  const satellite = new SatelliteProcess(dbName, adapter, migrator, notifier, client, opts)

  const tableInfo = initTableInfo()
  const timestamp = new Date().getTime()

  const runMigrations = async () => {
    await migrator.up()
  }

  t.context = {
    dbName,
    db,
    adapter,
    migrator,
    notifier,
    client,
    runMigrations,
    satellite,
    tableInfo,
    timestamp
  }
})

test.afterEach.always(async t => {
  const { dbName, satellite } = t.context as any

  await removeFile(dbName, {force: true})
  await removeFile(`${dbName}-journal`, {force: true})

  await satellite.stop()
})

test('setup starts a satellite process', async t => {
  const { satellite } = t.context as any

  t.true(satellite instanceof SatelliteProcess)
})

test('start creates system tables', async t => {
  const { adapter, satellite } = t.context as ContextType

  await satellite.start()

  const sql = "select name from sqlite_master where type = 'table'"
  const rows = await adapter.query({ sql })
  const names = rows.map(row => row.name)

  t.true(names.includes('_electric_oplog'))
})

test('load metadata', async t => {
  const { adapter, runMigrations } = t.context as ContextType
  await runMigrations()

  const meta = await loadSatelliteMetaTable(adapter)
  t.deepEqual(meta, {
    compensations: 0,
    lastAckdRowId: '0',
    lastSentRowId: '0',
    lsn: '',
    clientId: ''
  })
})

test('set persistent client id', async t => {
  const { satellite } = t.context as any

  await satellite.start()
  const clientId1 = satellite.clientId()
  await satellite.stop()

  await satellite.start()

  const clientId2 = satellite.clientId()

  t.assert(clientId1 === clientId2)
})

test('cannot UPDATE primary key', async t => {
  const { adapter, runMigrations } = t.context as any
  await runMigrations()

  await adapter.run({ sql: `INSERT INTO parent(id) VALUES ('1'),('2')` })
  await t.throwsAsync(adapter.run({ sql: `UPDATE parent SET id='3' WHERE id = '1'` }), {
    code: 'SQLITE_CONSTRAINT_TRIGGER'
  })
})

test('snapshot works', async t => {
  const { adapter, notifier, runMigrations, satellite } = t.context as ContextType
  await runMigrations()

  await adapter.run({ sql: `INSERT INTO parent(id) VALUES ('1'),('2')` })
  await satellite._performSnapshot()

  t.is(notifier.notifications.length, 1)

  const { changes } = notifier.notifications[0]
  const expectedChange = {
    qualifiedTablename: new QualifiedTablename('main', 'parent'),
    rowids: [1, 2]
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

test('starting and stopping the process works', async t => {
  const { adapter, notifier, runMigrations, satellite } = t.context as any
  await runMigrations()

  await adapter.run({ sql: `INSERT INTO parent(id) VALUES ('1'),('2')` })

  await satellite.start()

  await sleepAsync(opts.pollingInterval)

  t.is(notifier.notifications.length, 1)

  await adapter.run({ sql: `INSERT INTO parent(id) VALUES ('3'),('4')` })
  await sleepAsync(opts.pollingInterval)

  t.is(notifier.notifications.length, 2)

  await satellite.stop()
  await adapter.run({ sql: `INSERT INTO parent(id) VALUES ('5'),('6')` })
  await sleepAsync(opts.pollingInterval)

  t.is(notifier.notifications.length, 2)

  await satellite.start()
  await sleepAsync(0)

  t.is(notifier.notifications.length, 3)
})

test('snapshots on potential data change', async t => {
  const { adapter, notifier, runMigrations } = t.context as any
  await runMigrations()

  await adapter.run({ sql: `INSERT INTO parent(id) VALUES ('1'),('2')` })

  t.is(notifier.notifications.length, 0)

  await notifier.potentiallyChanged()

  t.is(notifier.notifications.length, 1)
})

// INSERT after DELETE shall nullify all non explicitly set columns
// If last operation is a DELETE, concurrent INSERT shall resurrect deleted
// values as in 'INSERT wins over DELETE and restored deleted values'
test('snapshot of INSERT after DELETE', async t => {
  const { adapter, runMigrations, satellite } = t.context as any
  try {
  await runMigrations()

    await adapter.run({ sql: `INSERT INTO parent(id, value) VALUES (1,'val1')` })
    await adapter.run({ sql: `DELETE FROM parent WHERE id=1` })
    await adapter.run({ sql: `INSERT INTO parent(id) VALUES (1)` })

  await satellite._performSnapshot()
  const entries = await satellite._getEntries()

  const merged = operationsToTableChanges(entries)
  const changes = merged['main.parent']['1'].changes
    const resultingValue = changes.value.value
  t.is(resultingValue, null)
  } catch (error) {
    console.log(error)
  }

})

test('take snapshot and merge local wins', async t => {
  const { adapter, runMigrations, satellite, tableInfo } = t.context as any
  await runMigrations()

  const incomingTs = new Date().getTime()
  const incomingEntry = generateOplogEntry(tableInfo, 'main', 'parent', OPTYPES.insert, incomingTs, {
    id: 1,
    value: 'incoming',
  })

  await adapter.run({ sql: `INSERT INTO parent(id, value, otherValue) VALUES (1, 'local', 1)` })
  await satellite._performSnapshot()

  const local = await satellite._getEntries()
  const localTimestamp = new Date(local[0].timestamp).getTime()
  const merged = satellite._mergeEntries(local, [incomingEntry])
  const item = merged['main.parent']['1']

  t.deepEqual(item, {
    namespace: 'main',
    tablename: 'parent',
    primaryKeyCols: { id: 1 },
    optype: OPTYPES.upsert,
    changes: {
      id: {value: 1, timestamp: localTimestamp},
      value: {value: 'local', timestamp: localTimestamp},
      otherValue: {value: 1, timestamp: localTimestamp},
    }
  })
})

test('take snapshot and merge incoming wins', async t => {
  const { adapter, runMigrations, satellite, tableInfo } = t.context as any
  await runMigrations()

  await adapter.run({ sql: `INSERT INTO parent(id, value, otherValue) VALUES (1, 'local', 1)` })
  await satellite._performSnapshot()

  const local = await satellite._getEntries()
  const localTimestamp = new Date(local[0].timestamp).getTime()

  const incomingTs = localTimestamp + 1
  const incomingEntry = generateOplogEntry(tableInfo, 'main', 'parent', OPTYPES.insert, incomingTs, {
    id: 1,
    value: 'incoming',
  })

  const merged = satellite._mergeEntries(local, [incomingEntry])
  const item = merged['main.parent']['1']

  t.deepEqual(item, {
    namespace: 'main',
    tablename: 'parent',
    primaryKeyCols: { id: 1 },
    optype: OPTYPES.upsert,
    changes: {
      id: {value: 1, timestamp: incomingTs},
      value: {value: 'incoming', timestamp: incomingTs},
      otherValue: {value: 1, timestamp: localTimestamp},
    }
  })
})

test('apply does not add anything to oplog', async t => {
  const { adapter, runMigrations, satellite, tableInfo } = t.context as any
  await runMigrations()

  await adapter.run({ sql: `INSERT INTO parent(id, value, otherValue) VALUES (1, 'local', null)` })
  await satellite._performSnapshot()

  const incomingTs = new Date().getTime()
  const incomingEntry = generateOplogEntry(tableInfo, 'main', 'parent', OPTYPES.insert, incomingTs, {
    id: 1,
    value: 'incoming',
    otherValue: 1,
  })

  await satellite._apply([incomingEntry])
  await satellite._performSnapshot()

  const sql = 'SELECT * from parent WHERE id=1'
  const [row] = await adapter.query({ sql })
  t.is(row.value, 'incoming')
  t.is(row.otherValue, 1)

  const localEntries = await satellite._getEntries()
  t.is(localEntries.length, 1)
})

test('apply incoming with no local', async t => {
  const { adapter, runMigrations, satellite, tableInfo } = t.context as any
  await runMigrations()

  const incomingTs = new Date().getTime()
  const incomingEntry = generateOplogEntry(tableInfo, 'main', 'parent', OPTYPES.delete, incomingTs, {
    id: 1,
    value: 'incoming',
    otherValue: 1,
  })

  await satellite._apply([incomingEntry])

  const sql = 'SELECT * from parent WHERE id=1'
  const rows = await adapter.query({ sql })
  t.is(rows.length, 0)
})

test('apply empty incoming', async t => {
  const { runMigrations, satellite } = t.context as any
  await runMigrations()

  await satellite._apply([])

  t.true(true)
})

test('apply incoming with null on column with default', async t => {
  const { runMigrations, satellite, adapter, tableInfo } = t.context as any
  await runMigrations()

  const incomingTs = new Date().getTime()
  const incomingEntry = generateOplogEntry(tableInfo, 'main', 'items', OPTYPES.insert, incomingTs, {
    value: 'incoming',
    otherValue: null,
  })

  await satellite._apply([incomingEntry])

  const sql = `SELECT * from main.items WHERE value='incoming'`
  const rows = await adapter.query({ sql })

  t.is(rows[0].otherValue, null)
  t.pass()
})

test('apply incoming with undefined on column with default', async t => {
  const { runMigrations, satellite, adapter, tableInfo } = t.context as any
  await runMigrations()

  const incomingTs = new Date().getTime()
  const incomingEntry = generateOplogEntry(tableInfo, 'main', 'items', OPTYPES.insert, incomingTs, {
    value: 'incoming'
  })

  await satellite._apply([incomingEntry])

  const sql = `SELECT * from main.items WHERE value='incoming'`
  const rows = await adapter.query({ sql })

  t.is(rows[0].otherValue, '')
  t.pass()
})

test('INSERT wins over DELETE and restored deleted values', async t => {
  const { satellite, tableInfo } = t.context as any

  const localTs = new Date().getTime()
  const incomingTs = localTs + 1

  const incoming = [
    generateOplogEntry(tableInfo, 'main', 'parent', OPTYPES.insert, incomingTs, {
      id: 1,
      otherValue: 1,
    }),
    generateOplogEntry(tableInfo, 'main', 'parent', OPTYPES.delete, incomingTs, {
      id: 1
    })
  ]

  const local = [
    generateOplogEntry(tableInfo, 'main', 'parent', OPTYPES.insert, localTs, {
      id: 1,
      value: 'local',
      otherValue: null,
    })
  ]

  const merged = satellite._mergeEntries(local, incoming)
  const item = merged['main.parent']['1']

  t.deepEqual(item, {
    namespace: 'main',
    tablename: 'parent',
    primaryKeyCols: { id: 1 },
    optype: OPTYPES.upsert,
    changes: {
      id: {value: 1, timestamp: incomingTs},
      value: {value: 'local', timestamp: localTs},
      otherValue: {value: 1, timestamp: incomingTs}
    }
  })
})

test('merge incoming with empty local', async t => {
  const { satellite, tableInfo } = t.context as any

  const localTs = new Date().getTime()
  const incomingTs = localTs + 1

  const incoming = [
    generateOplogEntry(tableInfo, 'main', 'parent', OPTYPES.insert, incomingTs, {
      id: 1
    })
  ]

  const local = []

  const merged = satellite._mergeEntries(local, incoming)
  const item = merged['main.parent']['1']

  t.deepEqual(item, {
    namespace: 'main',
    tablename: 'parent',
    primaryKeyCols: { id: 1 },
    optype: OPTYPES.upsert,
    changes: {
      id: {value: 1, timestamp: incomingTs}
    }
  })
})

test('advance oplog cursor', async t => {
  const { adapter, runMigrations, satellite } = t.context as any
  await runMigrations()

  // fake current propagated rowId
  satellite._lastSentRowId = 2;

  // Get tablenames.
  const oplogTablename = opts.oplogTable.tablename
  const metaTablename = opts.metaTable.tablename

  // Insert a couple of rows.
  await adapter.run({ sql: `INSERT INTO main.parent(id) VALUES ('1'),('2')` })

  // We have two rows in the oplog.
  let rows = await adapter.query({ sql: `SELECT count(rowid) as num_rows FROM ${oplogTablename}` })
  t.is(rows[0].num_rows, 2)

  // Ack.
  await satellite._ack(2, true)

  // The oplog is clean.
  rows = await adapter.query({ sql: `SELECT count(rowid) as num_rows FROM ${oplogTablename}` })
  t.is(rows[0].num_rows, 0)

  // Verify the meta.
  rows = await adapter.query({ sql: `SELECT value FROM ${metaTablename} WHERE key = 'lastAckdRowId'` })
  t.is(rows[0].value, '2')
})

test('compensations: referential integrity is enforced', async t => {
  const { adapter, runMigrations, satellite } = t.context as any
  await runMigrations()

  await adapter.run({ sql: `PRAGMA foreign_keys = ON` })
  await satellite._setMeta('compensations', 0)

  await adapter.run({ sql: `INSERT INTO main.parent(id, value) VALUES (1, '1')` })

  await t.throwsAsync(adapter.run({ sql: `INSERT INTO main.child(id, parent) VALUES (1, 2)` }), {
    code: 'SQLITE_CONSTRAINT_FOREIGNKEY'
  })
})

test('compensations: incoming operation breaks referential integrity', async t => {
  const { adapter, runMigrations, satellite, tableInfo, timestamp } = t.context as any
  await runMigrations()

  await adapter.run({ sql: `PRAGMA foreign_keys = ON;` })
  await satellite._setMeta('compensations', 0)

  const incoming = [
    generateOplogEntry(tableInfo, 'main', 'child', OPTYPES.insert, timestamp, {
      id: 1,
      parent: 1
    })
  ]

  await t.throwsAsync(satellite._apply(incoming), {
    code: 'SQLITE_CONSTRAINT_FOREIGNKEY'
  })
})

test('compensations: incoming operations accepted if restore referential integrity', async t => {
  const { adapter, runMigrations, satellite, tableInfo, timestamp } = t.context as any
  await runMigrations()

  await adapter.run({ sql: `PRAGMA foreign_keys = ON;` })
  await satellite._setMeta('compensations', 0)

  const incoming = [
    generateOplogEntry(tableInfo, 'main', 'child', OPTYPES.insert, timestamp, {
      id: 1,
      parent: 1
    }),
    generateOplogEntry(tableInfo, 'main', 'parent', OPTYPES.insert, timestamp, {
      id: 1
    })
  ]

  await adapter.run({ sql: `INSERT INTO main.parent(id, value) VALUES (1, '1')` })
  await adapter.run({ sql: `DELETE FROM main.parent WHERE id=1` })
  await satellite._performSnapshot()
  await satellite._apply(incoming)
  const rows = await adapter.query({ sql: `SELECT * from main.parent WHERE id=1` })

  // Not only does the parent exist.
  t.is(rows.length, 1)

  // But it's also recreated with deleted values.
  t.is(rows[0].value, '1')
})

test('compensations: using triggers with flag 0', async t => {
  const { adapter, runMigrations, satellite, tableInfo } = t.context as any
  await runMigrations()

  await adapter.run({ sql: `PRAGMA foreign_keys = ON` })
  await satellite._setMeta('compensations', 0)
  satellite._lastSentRowId = 1

  await adapter.run({ sql: `INSERT INTO main.parent(id, value) VALUES (1, '1')` })
  await satellite._performSnapshot()
  await satellite._ack(1, true)

  await adapter.run({ sql: `INSERT INTO main.child(id, parent) VALUES (1, 1)` })
  await satellite._performSnapshot()

  const timestamp = new Date().getTime()
  const incoming = [
    generateOplogEntry(tableInfo, 'main', 'parent', OPTYPES.delete, timestamp, {id: 1})
  ]
  await t.throwsAsync(satellite._apply(incoming), {
    code: 'SQLITE_CONSTRAINT_FOREIGNKEY'
  })
})

test('compensations: using triggers with flag 1', async t => {
  const { adapter, runMigrations, satellite, tableInfo } = t.context as ContextType
  await runMigrations()

  await adapter.run({ sql: `PRAGMA foreign_keys = ON` })
  await satellite._setMeta('compensations', 1)
  satellite._lastSentRowId = 1

  await adapter.run({ sql: `INSERT INTO main.parent(id, value) VALUES (1, '1')` })
  await satellite._performSnapshot()
  await satellite._ack(1, true)

  await adapter.run({ sql: `INSERT INTO main.child(id, parent) VALUES (1, 1)` })
  await satellite._performSnapshot()

  const timestamp = new Date().getTime()
  const incoming = [
    generateOplogEntry(tableInfo, 'main', 'parent', OPTYPES.delete, timestamp, {id: 1})
  ]
  await satellite._apply(incoming)
  t.true(true)
})

test('get oplogEntries from transaction', async t => {
  const { runMigrations, satellite } = t.context as ContextType
  await runMigrations()

  const relations = await satellite['_getLocalRelations']()

  const transaction: Transaction = {
    lsn: DEFAULT_LOG_POS,
    commit_timestamp: Long.UZERO,
    changes: [
      {
        relation: relations.parent,
        type: ChangeType.INSERT,
        record: { 'id': 0 }
      }]
  }

  const expected: OplogEntry = {
    namespace: 'main',
    tablename: 'parent',
    optype: 'INSERT',
    newRow: '{"id":0}',
    oldRow: undefined,
    primaryKey: '{"id":0}',
    rowid: -1,
    timestamp: '1970-01-01T00:00:00.000Z'
  }

  const opLog = fromTransaction(transaction, relations)
  t.deepEqual(opLog[0], expected)
});

test('get transactions from opLogEntries', async t => {
  const { runMigrations } = t.context as ContextType
  await runMigrations()

  const opLogEntries: OplogEntry[] = [{
    namespace: 'public',
    tablename: 'parent',
    optype: 'INSERT',
    newRow: '{"id":0}',
    oldRow: undefined,
    primaryKey: '{"id":0}',
    rowid: 1,
    timestamp: '1970-01-01T00:00:00.000Z'
  },
  {
    namespace: 'public',
    tablename: 'parent',
    optype: 'UPDATE',
    newRow: '{"id":1}',
    oldRow: '{"id":1}',
    primaryKey: '{"id":1}',
    rowid: 2,
    timestamp: '1970-01-01T00:00:00.000Z'
  },
  {
    namespace: 'public',
    tablename: 'parent',
    optype: 'INSERT',
    newRow: '{"id":2}',
    oldRow: undefined,
    primaryKey: '{"id":0}',
    rowid: 3,
    timestamp: '1970-01-01T00:00:01.000Z'
  }
  ]

  const expected = [
    {
      lsn: numberToBytes(2),
      commit_timestamp: Long.UZERO,
      changes: [
        {  
          relation: relations.parent,        
          type: ChangeType.INSERT,
          record: { 'id': 0 },
          oldRecord: undefined
        },
        {        
          relation: relations.parent,  
          type: ChangeType.INSERT,
          record: { 'id': 1 },
          oldRecord: { 'id': 1 },
        }]
    },
    {
      lsn: numberToBytes(3),
      commit_timestamp: Long.UZERO.add(1000),
      changes: [
        { 
          relation: relations.parent,
          type: ChangeType.INSERT,
          record: { 'id': 2 },
          oldRecord: undefined
        },
      ]
    }
  ]

  const opLog = toTransactions(opLogEntries, relations)
  t.deepEqual(opLog, expected)
});

test('rowid acks updates meta', async t => {
  const { runMigrations, satellite, client } = t.context as ContextType
  await runMigrations()
  await satellite.start()

  const lsn1 = numberToBytes(1)
  client['emit']("ack_lsn", lsn1, false)

  const lsn = await satellite['_getMeta']('lastSentRowId')
  t.is(lsn, "1")
})

test('handling connectivity state change stops queueing operations', async t => {
  const { runMigrations, satellite, adapter } = t.context as ContextType
  await runMigrations()
  await satellite.start()

  adapter.run({ sql: `INSERT INTO parent(id, value, otherValue) VALUES (1, 'local', 1)` })

  await satellite._performSnapshot()

  const lsn = await satellite._getMeta('lastSentRowId')
  t.is(lsn, "1")

  await new Promise<void>((res) => {
    setTimeout(async () => {
      const lsn = await satellite._getMeta('lastAckdRowId')
      t.is(lsn, "1")
      res()
    }, 100)
  })

  satellite._connectivityStateChange('disconnected')

  adapter.run({ sql: `INSERT INTO parent(id, value, otherValue) VALUES (2, 'local', 1)` })

  await satellite._performSnapshot()

  const lsn1 = await satellite._getMeta('lastSentRowId')
  t.is(lsn1, "1")


  await satellite._connectivityStateChange('connected')

  setTimeout(async () => {
    const lsn2 = await satellite._getMeta('lastSentRowId')
    t.is(lsn2, "2")
  }, 200)
})

// Document if we support CASCADE https://www.sqlite.org/foreignkeys.html
// Document that we do not maintian the order of execution of incoming operations and therefore we defer foreign key checks to the outermost commit
