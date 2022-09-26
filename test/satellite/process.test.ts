import { readFile, rm as removeFile } from 'node:fs/promises'

import test from 'ava'

import Database from 'better-sqlite3'
import { DatabaseAdapter } from '../../src/drivers/better-sqlite3/adapter'

import { MockSatelliteClient } from '../../src/satellite/mock'
import { MockMigrator } from '../../src/migrators/mock'
import { MockNotifier } from '../../src/notifiers/mock'
import { randomValue } from '../../src/util/random'
import { QualifiedTablename } from '../../src/util/tablename'
import { sleepAsync } from '../../src/util/timer'

import { OPTYPES, operationsToTableChanges, fromTransaction, OplogEntry, toTransactions } from '../../src/satellite/oplog'
import { satelliteDefaults } from '../../src/satellite/config'
import { SatelliteProcess } from '../../src/satellite/process'

import { initTableInfo, loadSatelliteMetaTable, generateOplogEntry } from '../support/satellite-helpers'
import { SatRelation_RelationType } from '../../src/_generated/proto/satellite'
import Long from 'long'
import { ChangeType, Transaction } from '../../src/util/types'

// Speed up the intervals for testing.
const opts = Object.assign({}, satelliteDefaults, {
  minSnapshotWindow: 20,
  pollingInterval: 100
})

test.beforeEach(t => {
  const dbName = `test-${randomValue()}.db`
  const db = new Database(dbName)
  const adapter = new DatabaseAdapter(db)
  const migrator = new MockMigrator()
  const notifier = new MockNotifier(dbName)
  const client = new MockSatelliteClient()
  const satellite = new SatelliteProcess(dbName, adapter, migrator, notifier, client, opts)

  const tableInfo = initTableInfo()
  const timestamp = new Date().getTime()

  const runMigrations = async () => {
    const sql = await readFile('./test/support/compensation.test.sql', {encoding: 'utf8'})
    await adapter.run(sql)
  }

  t.context = {
    dbName,
    db,
    adapter,
    migrator,
    notifier,
    runMigrations,
    satellite,
    tableInfo,
    timestamp
  }
})

test.afterEach.always(async t => {
  const { dbName } = t.context as any

  await removeFile(dbName, {force: true})
  await removeFile(`${dbName}-journal`, {force: true})
})

test('setup starts a satellite process', async t => {
  const { satellite } = t.context as any

  t.true(satellite instanceof SatelliteProcess)
})

test('start requires system tables', async t => {
  const { satellite } = t.context as any

  await t.throwsAsync(satellite.start(), {
    message: 'Invalid database schema. You need to run valid Electric SQL migrations.'
  })
})

test('start works after running migrations', async t => {
  const { satellite, runMigrations } = t.context as any

  await runMigrations()
  await satellite.start()
  await satellite.stop()

  t.true(true)
})

test('load metadata', async t => {
  const { adapter, runMigrations } = t.context as any
  await runMigrations()

  const meta = await loadSatelliteMetaTable(adapter)
  t.deepEqual(meta, { ackRowId: '-1', currRowId: '-1', compensations: '0' })
})

test('cannot UPDATE primary key', async t => {
  const { adapter, runMigrations } = t.context as any
  await runMigrations()

  await adapter.run(`INSERT INTO parent(id) VALUES ('1'),('2')`)
  await t.throwsAsync(adapter.run(`UPDATE parent SET id='3' WHERE id = '1'`), {
    code: 'SQLITE_CONSTRAINT_TRIGGER'
  })
})

test('snapshot works', async t => {
  const { adapter, notifier, runMigrations, satellite } = t.context as any
  await runMigrations()

  await adapter.run(`INSERT INTO parent(id) VALUES ('1'),('2')`)
  await satellite._performSnapshot()

  t.is(notifier.notifications.length, 1)

  const { changes } = notifier.notifications[0]
  const expectedChange = {
    qualifiedTablename: new QualifiedTablename('main', 'parent'),
    rowids: [1, 2]
  }

  t.deepEqual(changes, [expectedChange])
})

test('throttled snapshot respects window', async t => {
  const { adapter, notifier, runMigrations, satellite } = t.context as any
  await runMigrations()

  await satellite._throttledSnapshot()
  t.is(notifier.notifications.length, 0)

  await adapter.run(`INSERT INTO parent(id) VALUES ('1'),('2')`)
  await satellite._throttledSnapshot()

  t.is(notifier.notifications.length, 0)

  await sleepAsync(opts.minSnapshotWindow)

  t.is(notifier.notifications.length, 1)
})

test('starting and stopping the process works', async t => {
  const { adapter, notifier, runMigrations, satellite } = t.context as any
  await runMigrations()

  await adapter.run(`INSERT INTO parent(id) VALUES ('1'),('2')`)

  await satellite.start()
  t.is(notifier.notifications.length, 0)

  await sleepAsync(opts.pollingInterval)

  t.is(notifier.notifications.length, 1)

  await adapter.run(`INSERT INTO parent(id) VALUES ('3'),('4')`)
  await sleepAsync(opts.pollingInterval)

  t.is(notifier.notifications.length, 2)

  await satellite.stop()
  await adapter.run(`INSERT INTO parent(id) VALUES ('5'),('6')`)
  await sleepAsync(opts.pollingInterval)

  t.is(notifier.notifications.length, 2)

  await satellite.start()
  await sleepAsync(0)

  t.is(notifier.notifications.length, 3)
})

test('snapshots on potential data change', async t => {
  const { adapter, notifier, runMigrations } = t.context as any
  await runMigrations()

  await adapter.run(`INSERT INTO parent(id) VALUES ('1'),('2')`)

  t.is(notifier.notifications.length, 0)

  await notifier.potentiallyChanged()

  t.is(notifier.notifications.length, 1)
})

// INSERT after DELETE shall nullify all non explicitly set columns
// If last operation is a DELETE, concurrent INSERT shall resurrect deleted
// values as in 'INSERT wins over DELETE and restored deleted values'
test('snapshot of INSERT after DELETE', async t => {
  const { adapter, runMigrations, satellite } = t.context as any
  await runMigrations()

  await adapter.run(`INSERT INTO parent(id, value) VALUES (1,'val1')`)
  await adapter.run(`DELETE FROM parent WHERE id=1`)
  await adapter.run(`INSERT INTO parent(id) VALUES (1)`)

  await satellite._performSnapshot()
  const entries = await satellite._getEntries()

  const merged = operationsToTableChanges(entries)
  const changes = merged['main.parent']['1'].changes
  const resultingValue = changes.value.value

  t.is(resultingValue, null)
})

test('take snapshot and merge local wins', async t => {
  const { adapter, runMigrations, satellite, tableInfo } = t.context as any
  await runMigrations()

  const incomingTs = new Date().getTime()
  const incomingEntry = generateOplogEntry(tableInfo, 'main', 'parent', OPTYPES.insert, incomingTs, {
    id: 1,
    value: 'incoming',
  })

  await adapter.run(`INSERT INTO parent(id, value, otherValue) VALUES (1, 'local', 1)`)
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

  await adapter.run(`INSERT INTO parent(id, value, otherValue) VALUES (1, 'local', 1)`)
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

  await adapter.run(`INSERT INTO parent(id, value, otherValue) VALUES (1, 'local', null)`)
  await satellite._performSnapshot()

  const incomingTs = new Date().getTime()
  const incomingEntry = generateOplogEntry(tableInfo, 'main', 'parent', OPTYPES.insert, incomingTs, {
    id: 1,
    value: 'incoming',
    otherValue: 1,
  })

  await satellite._apply([incomingEntry])
  await satellite._performSnapshot()

  const [row] = await adapter.query('SELECT * from parent WHERE id=1')
  t.is(row.value, 'incoming')
  t.is(row.otherValue, 1)

  const localEntries = await satellite._getEntries()
  t.is(localEntries.length, 1)
})

test('apply incoming DELETE', async t => {
  const { adapter, runMigrations, satellite, tableInfo } = t.context as any
  await runMigrations()

  await adapter.run(`INSERT INTO parent(id) VALUES (1)`)
  let rows = await adapter.query('SELECT * from parent WHERE id=1')
  t.is(rows.length, 1)

  const incomingTs = new Date().getTime()
  const incomingEntry = generateOplogEntry(tableInfo, 'main', 'parent', OPTYPES.delete, incomingTs, {
    id: 1,
    value: 'incoming',
    otherValue: 1,
  })

  await satellite._apply([incomingEntry])

  rows = await adapter.query('SELECT * from parent WHERE id=1')
  t.is(rows.length, 0)
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

  const rows = await adapter.query('SELECT * from parent WHERE id=1')
  t.is(rows.length, 0)
})

test('apply empty incoming', async t => {
  const { runMigrations, satellite } = t.context as any
  await runMigrations()

  await satellite._apply([])

  t.true(true)
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
  await adapter.run(`INSERT INTO main.parent(id) VALUES ('1'),('2')`)

  // We have two rows in the oplog.
  let rows = await adapter.query(`SELECT count(rowid) as num_rows FROM ${oplogTablename}`)
  t.is(rows[0].num_rows, 2)

  // Ack.
  await satellite._ack(2)

  // The oplog is clean.
  rows = await adapter.query(`SELECT count(rowid) as num_rows FROM ${oplogTablename}`)
  t.is(rows[0].num_rows, 0)

  // Verify the meta.
  rows = await adapter.query(`SELECT value FROM ${metaTablename} WHERE key = 'ackRowId'`)
  t.is(rows[0].value, '2')
})

test('compensations: referential integrity is enforced', async t => {
  const { adapter, runMigrations, satellite } = t.context as any
  await runMigrations()

  await adapter.run(`PRAGMA foreign_keys = ON`)
  await satellite._setMeta('compensations', 0)

  await adapter.run(`INSERT INTO main.parent(id, value) VALUES (1, '1')`)

  await t.throwsAsync(adapter.run(`INSERT INTO main.child(id, parent) VALUES (1, 2)`), {
    code: 'SQLITE_CONSTRAINT_FOREIGNKEY'
  })
})

test('compensations: incoming operation breaks referential integrity', async t => {
  const { adapter, runMigrations, satellite, tableInfo, timestamp } = t.context as any
  await runMigrations()

  await adapter.run(`PRAGMA foreign_keys = ON`)
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

  await adapter.run(`PRAGMA foreign_keys = ON`)
  await satellite._setMeta('compensations', 0)

  const incoming = [
    generateOplogEntry(tableInfo, 'main', 'child', OPTYPES.insert, timestamp, {
      id: 1,
      parent: 1
    }),
    // XXX todo: upsert all parent row attributes if possible.
    generateOplogEntry(tableInfo, 'main', 'parent', OPTYPES.insert, timestamp, {
      id: 1
    })
  ]

  await adapter.run(`INSERT INTO main.parent(id, value) VALUES (1, '1')`)
  await adapter.run(`DELETE FROM main.parent WHERE id=1`)
  await satellite._performSnapshot()
  await satellite._apply(incoming)
  const rows = await adapter.query(`SELECT * from main.parent WHERE id=1`)

  // Not only does the parent exist.
  t.is(rows.length, 1)

  // But it's also recreated with deleted values.
  t.is(rows[0].value, '1')
})

test('compensations: using triggers with flag 0', async t => {
  const { adapter, runMigrations, satellite, tableInfo } = t.context as any
  await runMigrations()

  await adapter.run(`PRAGMA foreign_keys = ON`)
  await satellite._setMeta('compensations', 0)
  satellite._lastSentRowId = 1

  await adapter.run(`INSERT INTO main.parent(id, value) VALUES (1, '1')`)
  await satellite._performSnapshot()
  await satellite._ack(1)

  await adapter.run(`INSERT INTO main.child(id, parent) VALUES (1, 1)`)
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
  const { adapter, runMigrations, satellite, tableInfo } = t.context as any
  await runMigrations()

  await adapter.run(`PRAGMA foreign_keys = ON`)
  await satellite._setMeta('compensations', 1)
  satellite._lastSentRowId = 1

  await adapter.run(`INSERT INTO main.parent(id, value) VALUES (1, '1')`)
  await satellite._performSnapshot()
  await satellite._ack(1)

  await adapter.run(`INSERT INTO main.child(id, parent) VALUES (1, 1)`)
  await satellite._performSnapshot()

  const timestamp = new Date().getTime()
  const incoming = [
    generateOplogEntry(tableInfo, 'main', 'parent', OPTYPES.delete, timestamp, {id: 1})
  ]
  await satellite._apply(incoming)
  t.true(true)
})

test('get primary keys for tables', async t => {
  const { runMigrations, satellite } = t.context as any
  await runMigrations()

  const pks = await satellite._getPrimaryKeyForTables()
  const expectedPks = {
    'child': ['id'],
    'parent': ['id']
  }
  t.deepEqual(pks, expectedPks)
})

test('get oplogEntries from transaction', async t => {
  const { runMigrations, satellite } = t.context as any
  await runMigrations()

  const pks = await satellite._getPrimaryKeyForTables()

  const transaction: Transaction = {
    lsn: "0",
    commit_timestamp: Long.ZERO,
    changes: [
      {
        relation: {
          id: 0,
          schema: '',
          table: 'parent',
          columns: [],
          tableType: SatRelation_RelationType.TABLE
        },
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

  const opLog = fromTransaction(transaction, pks)
  t.deepEqual(opLog[0], expected)
});

test('get transactions from opLogEntries', async t => {
  const { runMigrations } = t.context as any
  await runMigrations()

  const opLogEntries: OplogEntry[] = [{
    namespace: 'main',
    tablename: 'parent',
    optype: 'INSERT',
    newRow: '{"id":0}',
    oldRow: undefined,
    primaryKey: '{"id":0}',
    rowid: 1,
    timestamp: '1970-01-01T00:00:00.000Z'
  },
  {
    namespace: 'main',
    tablename: 'parent',
    optype: 'UPDATE',
    newRow: '{"id":1}',
    oldRow: '{"id":1}',
    primaryKey: '{"id":1}',
    rowid: 2,
    timestamp: '1970-01-01T00:00:00.000Z'
  },
  {
    namespace: 'main',
    tablename: 'parent',
    optype: 'INSERT',
    newRow: '{"id":2}',
    oldRow: undefined,
    primaryKey: '{"id":0}',
    rowid: 3,
    timestamp: '1970-01-01T00:00:01.000Z'
  }
  ]

  const expected: Transaction[] = [
    {
      lsn: "2",
      commit_timestamp: Long.ZERO,
      changes: [
        {
          relation: {
            id: 0,
            schema: 'public',
            table: 'parent',
            columns: [],
            tableType: SatRelation_RelationType.TABLE
          },
          type: ChangeType.INSERT,
          record: { 'id': 0 },
          oldRecord: undefined
        },
        {
          relation: {
            id: 0,
            schema: 'public',
            table: 'parent',
            columns: [],
            tableType: SatRelation_RelationType.TABLE
          },
          type: ChangeType.INSERT,
          record: { 'id': 1 },
          oldRecord: { 'id': 1 },
        }]
    },
    {
      lsn: "3",
      commit_timestamp: Long.ZERO.add(1000),
      changes: [
        {
          relation: {
            id: 0,
            schema: 'public',
            table: 'parent',
            columns: [],
            tableType: SatRelation_RelationType.TABLE
          },
          type: ChangeType.INSERT,
          record: { 'id': 2 },
          oldRecord: undefined
        },
      ]
    }
  ]

  const opLog = toTransactions(opLogEntries)
  t.deepEqual(opLog, expected)
});

// Document if we support CASCADE https://www.sqlite.org/foreignkeys.html
// Document that we do not maintian the order of execution of incoming operations and therefore we defer foreign key checks to the outermost commit
