import anyTest, { TestFn } from 'ava'
import Long from 'long'

import {
  OPTYPES,
  generateTag,
  encodeTags,
  opLogEntryToChange,
} from '../../../src/satellite/oplog'

import {
  generateRemoteOplogEntry,
  genEncodedTags,
  getPgMatchingShadowEntries as getMatchingShadowEntries,
} from '../../support/satellite-helpers'
import { Statement } from '../../../src/util/types'

import {
  makePgContext,
  cleanAndStopSatellite,
  relations,
  ContextType,
} from '../common'

const test = anyTest as TestFn<ContextType>
let port = 5100
test.beforeEach(async (t) => {
  await makePgContext(t, port++)
})
test.afterEach.always(cleanAndStopSatellite)

test('basic rules for setting tags', async (t) => {
  const { adapter, runMigrations, satellite, authState } = t.context
  await runMigrations()

  await satellite._setAuthState(authState)
  const clientId = satellite._authState?.clientId ?? 'test_client'

  await adapter.run({
    sql: `INSERT INTO main.parent(id, value, other) VALUES (1, 'local', null)`,
  })

  const txDate1 = await satellite._performSnapshot()
  let shadow = await getMatchingShadowEntries(adapter)
  t.is(shadow.length, 1)
  t.is(shadow[0].tags, genEncodedTags(clientId, [txDate1]))

  await adapter.run({
    sql: `UPDATE main.parent SET value = 'local1', other = 3 WHERE id = 1`,
  })

  const txDate2 = await satellite._performSnapshot()
  shadow = await getMatchingShadowEntries(adapter)
  t.is(shadow.length, 1)
  t.is(shadow[0].tags, genEncodedTags(clientId, [txDate2]))

  await adapter.run({
    sql: `UPDATE main.parent SET value = 'local2', other = 4 WHERE id = 1`,
  })

  const txDate3 = await satellite._performSnapshot()
  shadow = await getMatchingShadowEntries(adapter)
  t.is(shadow.length, 1)
  t.is(shadow[0].tags, genEncodedTags(clientId, [txDate3]))

  await adapter.run({
    sql: `DELETE FROM main.parent WHERE id = 1`,
  })

  const txDate4 = await satellite._performSnapshot()
  shadow = await getMatchingShadowEntries(adapter)
  t.is(shadow.length, 0)

  const entries = await satellite._getEntries()
  t.is(entries[0].clearTags, encodeTags([]))
  t.is(entries[1].clearTags, genEncodedTags(clientId, [txDate1]))
  t.is(entries[2].clearTags, genEncodedTags(clientId, [txDate2]))
  t.is(entries[3].clearTags, genEncodedTags(clientId, [txDate3]))

  t.not(txDate1, txDate2)
  t.not(txDate2, txDate3)
  t.not(txDate3, txDate4)
})

test('TX1=INSERT, TX2=DELETE, TX3=INSERT, ack TX1', async (t) => {
  const { adapter, runMigrations, satellite, tableInfo, authState } = t.context
  await runMigrations()
  await satellite._setAuthState(authState)

  const clientId = satellite._authState?.clientId ?? 'test_id'

  // Local INSERT
  const stmts1 = {
    sql: `INSERT INTO main.parent (id, value, other) VALUES ($1, $2, $3)`,
    args: ['1', 'local', null],
  }
  await adapter.runInTransaction(stmts1)
  const txDate1 = await satellite._performSnapshot()

  const localEntries1 = await satellite._getEntries()
  const shadowEntry1 = await getMatchingShadowEntries(adapter, localEntries1[0])

  // shadow tag is time of snapshot
  const tag1 = genEncodedTags(clientId, [txDate1])
  t.is(tag1, shadowEntry1[0].tags)
  // clearTag is empty
  t.like(localEntries1[0], {
    clearTags: JSON.stringify([]),
    timestamp: txDate1.toISOString(),
  })

  // Local DELETE
  const stmts2 = {
    sql: `DELETE FROM main.parent WHERE id=$1`,
    args: ['1'],
  }
  await adapter.runInTransaction(stmts2)
  const txDate2 = await satellite._performSnapshot()

  const localEntries2 = await satellite._getEntries()
  const shadowEntry2 = await getMatchingShadowEntries(adapter, localEntries2[1])

  // shadowTag is empty
  t.is(0, shadowEntry2.length)
  // clearTags contains previous shadowTag
  t.like(localEntries2[1], {
    clearTags: tag1,
    timestamp: txDate2.toISOString(),
  })

  // Local INSERT
  const stmts3 = {
    sql: `INSERT INTO main.parent (id, value, other) VALUES ($1, $2, $3)`,
    args: ['1', 'local', null],
  }
  await adapter.runInTransaction(stmts3)
  const txDate3 = await satellite._performSnapshot()

  const localEntries3 = await satellite._getEntries()
  const shadowEntry3 = await getMatchingShadowEntries(adapter, localEntries3[1])

  const tag3 = genEncodedTags(clientId, [txDate3])
  // shadow tag is tag3
  t.is(tag3, shadowEntry3[0].tags)
  // clearTags is empty after a DELETE
  t.like(localEntries3[2], {
    clearTags: JSON.stringify([]),
    timestamp: txDate3.toISOString(),
  })

  // apply incomig operation (local operation ack)
  const ackEntry = generateRemoteOplogEntry(
    tableInfo,
    'main',
    'parent',
    OPTYPES.insert,
    txDate1.getTime(),
    tag1,
    {
      id: 1,
      value: 'local',
      other: null,
    },
    undefined
  )

  const ackDataChange = opLogEntryToChange(ackEntry, relations)
  satellite.relations = relations // satellite must be aware of the relations in order to turn the `ackDataChange` DataChange into an OpLogEntry
  const tx = {
    origin: clientId,
    commit_timestamp: Long.fromNumber((txDate1 as Date).getTime()),
    changes: [ackDataChange],
    lsn: new Uint8Array(),
  }
  await satellite._applyTransaction(tx)

  // validate that garbage collection has been triggered
  t.is(2, (await satellite._getEntries()).length)

  const shadow = await getMatchingShadowEntries(adapter)
  t.like(
    shadow[0],
    {
      tags: genEncodedTags(clientId, [txDate3]),
    },
    'error: tag1 was reintroduced after merging acked operation'
  )
})

test('remote tx (INSERT) concurrently with local tx (INSERT -> DELETE)', async (t) => {
  const { adapter, runMigrations, satellite, tableInfo, authState } = t.context
  await runMigrations()
  await satellite._setAuthState(authState)

  const stmts: Statement[] = []

  // For this key we will choose remote Tx, such that: Local TM > Remote TX
  stmts.push({
    sql: `INSERT INTO main.parent (id, value, other) VALUES ($1, $2, $3);`,
    args: ['1', 'local', null],
  })
  stmts.push({ sql: `DELETE FROM main.parent WHERE id = 1` })
  // For this key we will choose remote Tx, such that: Local TM < Remote TX
  stmts.push({
    sql: `INSERT INTO main.parent (id, value, other) VALUES ($1, $2, $3);`,
    args: ['2', 'local', null],
  })
  stmts.push({ sql: `DELETE FROM main.parent WHERE id = 2` })
  await adapter.runInTransaction(...stmts)

  const txDate1 = await satellite._performSnapshot()

  const prevTs = txDate1.getTime() - 1
  const nextTs = txDate1.getTime() + 1

  const prevEntry = generateRemoteOplogEntry(
    tableInfo,
    'main',
    'parent',
    OPTYPES.insert,
    prevTs,
    genEncodedTags('remote', [prevTs]),
    {
      id: 1,
      value: 'remote',
      other: 1,
    },
    undefined
  )
  const nextEntry = generateRemoteOplogEntry(
    tableInfo,
    'main',
    'parent',
    OPTYPES.insert,
    nextTs,
    genEncodedTags('remote', [nextTs]),
    {
      id: 2,
      value: 'remote',
      other: 2,
    },
    undefined
  )

  satellite.relations = relations // satellite must be aware of the relations in order to turn `DataChange`s into `OpLogEntry`s

  const prevChange = opLogEntryToChange(prevEntry, relations)
  const prevTx = {
    origin: 'remote',
    commit_timestamp: Long.fromNumber(prevTs),
    changes: [prevChange],
    lsn: new Uint8Array(),
  }
  await satellite._applyTransaction(prevTx)

  const nextChange = opLogEntryToChange(nextEntry, relations)
  const nextTx = {
    origin: 'remote',
    commit_timestamp: Long.fromNumber(nextTs),
    changes: [nextChange],
    lsn: new Uint8Array(),
  }
  await satellite._applyTransaction(nextTx)

  const shadow = await getMatchingShadowEntries(adapter)
  const expectedShadow = [
    {
      namespace: 'main',
      tablename: 'parent',
      primaryKey: '{"id":1}',
      tags: genEncodedTags('remote', [prevTs]),
    },
    {
      namespace: 'main',
      tablename: 'parent',
      primaryKey: '{"id":2}',
      tags: genEncodedTags('remote', [nextTs]),
    },
  ]
  t.deepEqual(shadow, expectedShadow)

  const userTable = await adapter.query({ sql: `SELECT * FROM main.parent;` })

  // In both cases insert wins over delete, but
  // for id = 1 CR picks local data before delete, while
  // for id = 2 CR picks remote data
  const expectedUserTable = [
    { id: 1, value: 'local', other: null },
    { id: 2, value: 'remote', other: 2 },
  ]
  t.deepEqual(expectedUserTable, userTable)
})

test('remote tx (INSERT) concurrently with 2 local txses (INSERT -> DELETE)', async (t) => {
  const { adapter, runMigrations, satellite, tableInfo, authState } = t.context
  await runMigrations()
  await satellite._setAuthState(authState)

  let stmts: Statement[] = []

  // For this key we will choose remote Tx, such that: Local TM > Remote TX
  stmts.push({
    sql: `INSERT INTO main.parent (id, value, other) VALUES ($1, $2, $3);`,
    args: ['1', 'local', null],
  })
  stmts.push({
    sql: `INSERT INTO main.parent (id, value, other) VALUES ($1, $2, $3);`,
    args: ['2', 'local', null],
  })
  await adapter.runInTransaction(...stmts)
  const txDate1 = await satellite._performSnapshot()

  stmts = []
  // For this key we will choose remote Tx, such that: Local TM < Remote TX
  stmts.push({ sql: `DELETE FROM main.parent WHERE id = 1` })
  stmts.push({ sql: `DELETE FROM main.parent WHERE id = 2` })
  await adapter.runInTransaction(...stmts)
  await satellite._performSnapshot()

  const prevTs = txDate1.getTime() - 1
  const nextTs = txDate1.getTime() + 1

  const prevEntry = generateRemoteOplogEntry(
    tableInfo,
    'main',
    'parent',
    OPTYPES.insert,
    prevTs,
    genEncodedTags('remote', [prevTs]),
    {
      id: 1,
      value: 'remote',
      other: 1,
    },
    undefined
  )
  const nextEntry = generateRemoteOplogEntry(
    tableInfo,
    'main',
    'parent',
    OPTYPES.insert,
    nextTs,
    genEncodedTags('remote', [nextTs]),
    {
      id: 2,
      value: 'remote',
      other: 2,
    },
    undefined
  )

  satellite.relations = relations // satellite must be aware of the relations in order to turn `DataChange`s into `OpLogEntry`s in `_applyTransaction`

  const prevChange = opLogEntryToChange(prevEntry, relations)
  const prevTx = {
    origin: 'remote',
    commit_timestamp: Long.fromNumber(prevTs),
    changes: [prevChange],
    lsn: new Uint8Array(),
  }
  await satellite._applyTransaction(prevTx)

  const nextChange = opLogEntryToChange(nextEntry, relations)
  const nextTx = {
    origin: 'remote',
    commit_timestamp: Long.fromNumber(nextTs),
    changes: [nextChange],
    lsn: new Uint8Array(),
  }
  await satellite._applyTransaction(nextTx)

  const shadow = await getMatchingShadowEntries(adapter)
  const expectedShadow = [
    {
      namespace: 'main',
      tablename: 'parent',
      primaryKey: '{"id":1}',
      tags: genEncodedTags('remote', [prevTs]),
    },
    {
      namespace: 'main',
      tablename: 'parent',
      primaryKey: '{"id":2}',
      tags: genEncodedTags('remote', [nextTs]),
    },
  ]
  t.deepEqual(shadow, expectedShadow)

  let userTable = await adapter.query({ sql: `SELECT * FROM main.parent;` })

  // In both cases insert wins over delete, but
  // for id = 1 CR picks local data before delete, while
  // for id = 2 CR picks remote data
  const expectedUserTable = [
    { id: 1, value: 'local', other: null },
    { id: 2, value: 'remote', other: 2 },
  ]
  t.deepEqual(expectedUserTable, userTable)
})

test('remote tx (INSERT) concurrently with local tx (INSERT -> UPDATE)', async (t) => {
  const { adapter, runMigrations, satellite, tableInfo, authState } = t.context
  await runMigrations()
  await satellite._setAuthState(authState)
  const clientId = satellite._authState?.clientId ?? 'test_id'
  let stmts: Statement[] = []

  // For this key we will choose remote Tx, such that: Local TM > Remote TX
  stmts.push({
    sql: `INSERT INTO main.parent (id, value, other) VALUES ($1, $2, $3);`,
    args: ['1', 'local', null],
  })
  stmts.push({
    sql: `UPDATE main.parent SET value = $1, other = $2 WHERE id = 1`,
    args: ['local', 999],
  })
  // For this key we will choose remote Tx, such that: Local TM < Remote TX
  stmts.push({
    sql: `INSERT INTO main.parent (id, value, other) VALUES ($1, $2, $3);`,
    args: ['2', 'local', null],
  })
  stmts.push({
    sql: `UPDATE main.parent SET value = $1, other = $2 WHERE id = 1`,
    args: ['local', 999],
  })
  await adapter.runInTransaction(...stmts)

  const txDate1 = await satellite._performSnapshot()

  const prevTs = txDate1.getTime() - 1
  const nextTs = txDate1.getTime() + 1

  const prevEntry = generateRemoteOplogEntry(
    tableInfo,
    'main',
    'parent',
    OPTYPES.insert,
    prevTs,
    genEncodedTags('remote', [prevTs]),
    {
      id: 1,
      value: 'remote',
      other: 1,
    },
    undefined
  )

  const nextEntry = generateRemoteOplogEntry(
    tableInfo,
    'main',
    'parent',
    OPTYPES.insert,
    nextTs,
    genEncodedTags('remote', [nextTs]),
    {
      id: 2,
      value: 'remote',
      other: 2,
    },
    undefined
  )

  satellite.relations = relations // satellite must be aware of the relations in order to turn `DataChange`s into `OpLogEntry`s in `_applyTransaction`

  const prevChange = opLogEntryToChange(prevEntry, relations)
  const prevTx = {
    origin: 'remote',
    commit_timestamp: Long.fromNumber(prevTs),
    changes: [prevChange],
    lsn: new Uint8Array(),
  }
  await satellite._applyTransaction(prevTx)

  const nextChange = opLogEntryToChange(nextEntry, relations)
  const nextTx = {
    origin: 'remote',
    commit_timestamp: Long.fromNumber(nextTs),
    changes: [nextChange],
    lsn: new Uint8Array(),
  }
  await satellite._applyTransaction(nextTx)

  let shadow = await getMatchingShadowEntries(adapter)
  const expectedShadow = [
    {
      namespace: 'main',
      tablename: 'parent',
      primaryKey: '{"id":1}',
      tags: encodeTags([
        generateTag(clientId, new Date(txDate1)),
        generateTag('remote', new Date(prevTs)),
      ]),
    },
    {
      namespace: 'main',
      tablename: 'parent',
      primaryKey: '{"id":2}',
      tags: encodeTags([
        generateTag(clientId, new Date(txDate1)),
        generateTag('remote', new Date(nextTs)),
      ]),
    },
  ]
  t.deepEqual(shadow, expectedShadow)

  let entries = await satellite._getEntries()

  // Given that Insert and Update happen within the same transaction clear should not
  // contain itself
  t.is(entries[0].clearTags, encodeTags([]))
  t.is(entries[1].clearTags, encodeTags([]))
  t.is(entries[2].clearTags, encodeTags([]))
  t.is(entries[3].clearTags, encodeTags([]))

  let userTable = await adapter.query({ sql: `SELECT * FROM main.parent;` })

  // In both cases insert wins over delete, but
  // for id = 1 CR picks local data before delete, while
  // for id = 2 CR picks remote data
  const expectedUserTable = [
    { id: 1, value: 'local', other: 999 },
    { id: 2, value: 'remote', other: 2 },
  ]
  t.deepEqual(expectedUserTable, userTable)
})

test('origin tx (INSERT) concurrently with local txses (INSERT -> DELETE)', async (t) => {
  //
  const { adapter, runMigrations, satellite, tableInfo, authState } = t.context
  await runMigrations()
  await satellite._setAuthState(authState)
  const clientId = satellite._authState?.clientId ?? 'test_id'

  let stmts: Statement[] = []

  // For this key we will choose remote Tx, such that: Local TM > Remote TX
  stmts.push({
    sql: `INSERT INTO main.parent (id, value, other) VALUES ($1, $2, $3);`,
    args: ['1', 'local', null],
  })
  stmts.push({
    sql: `INSERT INTO main.parent (id, value, other) VALUES ($1, $2, $3);`,
    args: ['2', 'local', null],
  })
  await adapter.runInTransaction(...stmts)
  const txDate1 = await satellite._performSnapshot()

  stmts = []
  // For this key we will choose remote Tx, such that: Local TM < Remote TX
  stmts.push({ sql: `DELETE FROM main.parent WHERE id = 1` })
  stmts.push({ sql: `DELETE FROM main.parent WHERE id = 2` })
  await adapter.runInTransaction(...stmts)
  await satellite._performSnapshot()

  let entries = await satellite._getEntries()
  t.assert(entries[0].newRow)
  t.assert(entries[1])
  t.assert(entries[1].newRow)

  // For this key we receive transaction which was older
  const electricEntrySameTs = new Date(entries[0].timestamp).getTime()
  let electricEntrySame = generateRemoteOplogEntry(
    tableInfo,
    entries[0].namespace,
    entries[0].tablename,
    OPTYPES.insert,
    electricEntrySameTs,
    genEncodedTags(clientId, [txDate1]),
    JSON.parse(entries[0].newRow!),
    undefined
  )

  // For this key we had concurrent insert transaction from another node `remote`
  // with same timestamp
  const electricEntryConflictTs = new Date(entries[1].timestamp).getTime()
  let electricEntryConflict = generateRemoteOplogEntry(
    tableInfo,
    entries[1].namespace,
    entries[1].tablename,
    OPTYPES.insert,
    electricEntryConflictTs,
    encodeTags([
      generateTag(clientId, txDate1),
      generateTag('remote', txDate1),
    ]),
    JSON.parse(entries[1].newRow!),
    undefined
  )

  satellite.relations = relations // satellite must be aware of the relations in order to turn `DataChange`s into `OpLogEntry`s in `_applyTransaction`

  const electricEntrySameChange = opLogEntryToChange(
    electricEntrySame,
    relations
  )
  const electricEntryConflictChange = opLogEntryToChange(
    electricEntryConflict,
    relations
  )
  const tx = {
    origin: clientId,
    commit_timestamp: Long.fromNumber(new Date().getTime()), // commit_timestamp doesn't matter for this test, it is only used to GC the oplog
    changes: [electricEntrySameChange, electricEntryConflictChange],
    lsn: new Uint8Array(),
  }
  await satellite._applyTransaction(tx)

  let shadow = await getMatchingShadowEntries(adapter)
  const expectedShadow = [
    {
      namespace: 'main',
      tablename: 'parent',
      primaryKey: '{"id":2}',
      tags: genEncodedTags('remote', [txDate1]),
    },
  ]
  t.deepEqual(shadow, expectedShadow)

  let userTable = await adapter.query({ sql: `SELECT * FROM main.parent;` })
  const expectedUserTable = [{ id: 2, value: 'local', other: null }]
  t.deepEqual(expectedUserTable, userTable)
})

test('local (INSERT -> UPDATE -> DELETE) with remote equivalent', async (t) => {
  const { runMigrations, satellite, tableInfo, authState, adapter } = t.context
  await runMigrations()
  await satellite._setAuthState(authState)
  const clientId = satellite._authState?.clientId ?? 'test_id'
  let txDate1 = new Date().getTime()

  const insertEntry = generateRemoteOplogEntry(
    tableInfo,
    'main',
    'parent',
    OPTYPES.update,
    txDate1,
    genEncodedTags('remote', [txDate1]),
    {
      id: 1,
      value: 'local',
    },
    undefined
  )

  const deleteDate = txDate1 + 1
  const deleteEntry = generateRemoteOplogEntry(
    tableInfo,
    'main',
    'parent',
    OPTYPES.delete,
    deleteDate,
    genEncodedTags('remote', []),
    {
      id: 1,
      value: 'local',
    },
    undefined
  )

  satellite.relations = relations // satellite must be aware of the relations in order to turn `DataChange`s into `OpLogEntry`s in `_applyTransaction`

  const insertChange = opLogEntryToChange(insertEntry, relations)
  const insertTx = {
    origin: clientId,
    commit_timestamp: Long.fromNumber(txDate1),
    changes: [insertChange],
    lsn: new Uint8Array(),
  }
  await satellite._applyTransaction(insertTx)

  let shadow = await getMatchingShadowEntries(adapter)
  const expectedShadow = [
    {
      namespace: 'main',
      tablename: 'parent',
      primaryKey: '{"id":1}',
      tags: genEncodedTags('remote', [txDate1]),
    },
  ]
  t.deepEqual(shadow, expectedShadow)

  const deleteChange = opLogEntryToChange(deleteEntry, relations)
  const deleteTx = {
    origin: clientId,
    commit_timestamp: Long.fromNumber(deleteDate),
    changes: [deleteChange],
    lsn: new Uint8Array(),
  }
  await satellite._applyTransaction(deleteTx)

  shadow = await getMatchingShadowEntries(adapter)
  t.deepEqual([], shadow)

  let entries = await satellite._getEntries(0)
  t.deepEqual([], entries)
})
