import { TestFn } from 'ava'
import Long from 'long'

import {
  OPTYPES,
  generateTag,
  encodeTags,
  opLogEntryToChange,
} from '../../src/satellite/oplog'

import {
  generateRemoteOplogEntry,
  genEncodedTags,
  getMatchingShadowEntries as getSqliteMatchingShadowEntries,
  getPgMatchingShadowEntries,
} from '../support/satellite-helpers'
import { Statement } from '../../src/util/types'

import { relations, ContextType as CommonContextType } from './common'

export type ContextType = CommonContextType & {
  getMatchingShadowEntries:
    | typeof getSqliteMatchingShadowEntries
    | typeof getPgMatchingShadowEntries
}

export const processTagsTests = (test: TestFn<ContextType>) => {
  test('basic rules for setting tags', async (t) => {
    const {
      adapter,
      runMigrations,
      satellite,
      authState,
      getMatchingShadowEntries,
    } = t.context
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
    const {
      adapter,
      runMigrations,
      satellite,
      tableInfo,
      authState,
      getMatchingShadowEntries,
    } = t.context
    await runMigrations()
    await satellite._setAuthState(authState)

    const clientId = satellite._authState?.clientId ?? 'test_id'

    // Local INSERT
    const stmts1 = {
      sql: `INSERT INTO main.parent (id, value, other) VALUES ('1', 'local', null)`,
    }
    await adapter.runInTransaction(stmts1)
    const txDate1 = await satellite._performSnapshot()

    const localEntries1 = await satellite._getEntries()
    const shadowEntry1 = await getMatchingShadowEntries(
      adapter,
      localEntries1[0]
    )

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
      sql: `DELETE FROM main.parent WHERE id='1'`,
    }
    await adapter.runInTransaction(stmts2)
    const txDate2 = await satellite._performSnapshot()

    const localEntries2 = await satellite._getEntries()
    const shadowEntry2 = await getMatchingShadowEntries(
      adapter,
      localEntries2[1]
    )

    // shadowTag is empty
    t.is(0, shadowEntry2.length)
    // clearTags contains previous shadowTag
    t.like(localEntries2[1], {
      clearTags: genEncodedTags(clientId, [txDate2, txDate1]),
      timestamp: txDate2.toISOString(),
    })

    // Local INSERT
    const stmts3 = {
      sql: `INSERT INTO main.parent (id, value, other) VALUES ('1', 'local', null)`,
    }
    await adapter.runInTransaction(stmts3)
    const txDate3 = await satellite._performSnapshot()

    const localEntries3 = await satellite._getEntries()
    const shadowEntry3 = await getMatchingShadowEntries(
      adapter,
      localEntries3[1]
    )

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
    const {
      adapter,
      runMigrations,
      satellite,
      tableInfo,
      authState,
      getMatchingShadowEntries,
    } = t.context
    await runMigrations()
    await satellite._setAuthState(authState)

    const stmts: Statement[] = []

    // For this key we will choose remote Tx, such that: Local TM > Remote TX
    stmts.push({
      sql: `INSERT INTO main.parent (id, value, other) VALUES ('1', 'local', null);`,
    })
    stmts.push({ sql: `DELETE FROM main.parent WHERE id = 1` })
    // For this key we will choose remote Tx, such that: Local TM < Remote TX
    stmts.push({
      sql: `INSERT INTO main.parent (id, value, other) VALUES ('2', 'local', null);`,
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
    const {
      adapter,
      runMigrations,
      satellite,
      tableInfo,
      authState,
      getMatchingShadowEntries,
    } = t.context
    await runMigrations()
    await satellite._setAuthState(authState)

    let stmts: Statement[] = []

    // For this key we will choose remote Tx, such that: Local TM > Remote TX
    stmts.push({
      sql: `INSERT INTO main.parent (id, value, other) VALUES ('1', 'local', null);`,
    })
    stmts.push({
      sql: `INSERT INTO main.parent (id, value, other) VALUES ('2', 'local', null);`,
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

  test('Tags are correctly set on multiple operations within snapshot/transaction', async (t) => {
    const { adapter, runMigrations, satellite, authState } = t.context
    await runMigrations()
    const clientId = 'test_client'
    satellite._setAuthState({ ...authState, clientId })

    // Insert 4 items in separate snapshots
    await adapter.run({
      sql: `INSERT INTO parent (id, value) VALUES (1, 'val1')`,
    })
    const ts1 = await satellite._performSnapshot()
    await adapter.run({
      sql: `INSERT INTO parent (id, value) VALUES (2, 'val2')`,
    })
    const ts2 = await satellite._performSnapshot()
    await adapter.run({
      sql: `INSERT INTO parent (id, value) VALUES (3, 'val3')`,
    })
    const ts3 = await satellite._performSnapshot()
    await adapter.run({
      sql: `INSERT INTO parent (id, value) VALUES (4, 'val4')`,
    })
    const ts4 = await satellite._performSnapshot()

    // Now delete them all in a single snapshot
    await adapter.run({ sql: `DELETE FROM parent` })
    const ts5 = await satellite._performSnapshot()

    // Now check that each delete clears the correct tag
    const entries = await satellite._getEntries(4)
    t.deepEqual(
      entries.map((x) => x.clearTags),
      [
        genEncodedTags(clientId, [ts5, ts1]),
        genEncodedTags(clientId, [ts5, ts2]),
        genEncodedTags(clientId, [ts5, ts3]),
        genEncodedTags(clientId, [ts5, ts4]),
      ]
    )
  })

  test('Tags are correctly set on subsequent operations in a TX', async (t) => {
    const { adapter, runMigrations, satellite, authState } = t.context

    await runMigrations()

    await adapter.run({
      sql: `INSERT INTO main.parent(id, value) VALUES (1,'val1')`,
    })

    // Since no snapshot was made yet
    // the timestamp in the oplog is not yet set
    const insertEntry = await adapter.query({
      sql: `SELECT timestamp, "clearTags" FROM main._electric_oplog WHERE rowid = 1`,
    })
    t.is(insertEntry[0].timestamp, null)
    t.deepEqual(JSON.parse(insertEntry[0].clearTags as string), [])

    await satellite._setAuthState(authState)
    await satellite._performSnapshot()

    const parseDate = (date: string) => new Date(date).getTime()

    // Now the timestamp is set
    const insertEntryAfterSnapshot = await adapter.query({
      sql: `SELECT timestamp, "clearTags" FROM main._electric_oplog WHERE rowid = 1`,
    })
    t.assert(insertEntryAfterSnapshot[0].timestamp != null)
    const insertTimestamp = parseDate(
      insertEntryAfterSnapshot[0].timestamp as string
    )
    t.deepEqual(JSON.parse(insertEntryAfterSnapshot[0].clearTags as string), [])

    // Now update the entry, then delete it, and then insert it again
    await adapter.run({
      sql: `UPDATE main.parent SET value = 'val2' WHERE id=1`,
    })

    await adapter.run({
      sql: `DELETE FROM main.parent WHERE id=1`,
    })

    await adapter.run({
      sql: `INSERT INTO main.parent(id, value) VALUES (1,'val3')`,
    })

    // Since no snapshot has been taken for these operations
    // their timestamp and clearTags should not be set
    const updateEntry = await adapter.query({
      sql: `SELECT timestamp, "clearTags" FROM main._electric_oplog WHERE rowid = 2`,
    })

    t.is(updateEntry[0].timestamp, null)
    t.deepEqual(JSON.parse(updateEntry[0].clearTags as string), [])

    const deleteEntry = await adapter.query({
      sql: `SELECT timestamp, "clearTags" FROM main._electric_oplog WHERE rowid = 3`,
    })

    t.is(deleteEntry[0].timestamp, null)
    t.deepEqual(JSON.parse(deleteEntry[0].clearTags as string), [])

    const reinsertEntry = await adapter.query({
      sql: `SELECT timestamp, "clearTags" FROM main._electric_oplog WHERE rowid = 4`,
    })

    t.is(reinsertEntry[0].timestamp, null)
    t.deepEqual(JSON.parse(reinsertEntry[0].clearTags as string), [])

    // Now take a snapshot for these operations
    await satellite._performSnapshot()

    // Now the timestamps should be set
    // The first operation (update) should override
    // the original insert (i.e. clearTags must contain the timestamp of the insert)
    const updateEntryAfterSnapshot = await adapter.query({
      sql: `SELECT timestamp, "clearTags" FROM main._electric_oplog WHERE rowid = 2`,
    })

    const rawTimestampTx2 = updateEntryAfterSnapshot[0].timestamp
    t.assert(rawTimestampTx2 != null)
    const timestampTx2 = parseDate(rawTimestampTx2 as string)

    t.is(
      updateEntryAfterSnapshot[0].clearTags,
      genEncodedTags(authState.clientId, [insertTimestamp])
    )

    // The second operation (delete) should have the same timestamp
    // and should contain the tag of the TX in its clearTags
    const deleteEntryAfterSnapshot = await adapter.query({
      sql: `SELECT timestamp, "clearTags" FROM main._electric_oplog WHERE rowid = 3`,
    })

    t.assert(deleteEntryAfterSnapshot[0].timestamp === rawTimestampTx2)
    t.is(
      deleteEntryAfterSnapshot[0].clearTags,
      genEncodedTags(authState.clientId, [timestampTx2])
    )

    // The third operation (reinsert) should have the same timestamp
    // and should contain the tag of the TX in its clearTags
    const reinsertEntryAfterSnapshot = await adapter.query({
      sql: `SELECT timestamp, "clearTags" FROM main._electric_oplog WHERE rowid = 4`,
    })

    t.assert(reinsertEntryAfterSnapshot[0].timestamp === rawTimestampTx2)
    t.is(
      reinsertEntryAfterSnapshot[0].clearTags,
      genEncodedTags(authState.clientId, [timestampTx2])
    )
  })

  test('remote tx (INSERT) concurrently with local tx (INSERT -> UPDATE)', async (t) => {
    const {
      adapter,
      runMigrations,
      satellite,
      tableInfo,
      authState,
      getMatchingShadowEntries,
    } = t.context
    await runMigrations()
    await satellite._setAuthState(authState)
    const clientId = satellite._authState?.clientId ?? 'test_id'
    let stmts: Statement[] = []

    // For this key we will choose remote Tx, such that: Local TM > Remote TX
    stmts.push({
      sql: `INSERT INTO main.parent (id, value, other) VALUES ('1', 'local', null);`,
    })
    stmts.push({
      sql: `UPDATE main.parent SET value = 'local', other = 999 WHERE id = 1`,
    })
    // For this key we will choose remote Tx, such that: Local TM < Remote TX
    stmts.push({
      sql: `INSERT INTO main.parent (id, value, other) VALUES ('2', 'local', null);`,
    })
    stmts.push({
      sql: `UPDATE main.parent SET value = 'local', other = 999 WHERE id = 1`,
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
    const {
      adapter,
      runMigrations,
      satellite,
      tableInfo,
      authState,
      getMatchingShadowEntries,
    } = t.context
    await runMigrations()
    await satellite._setAuthState(authState)
    const clientId = satellite._authState?.clientId ?? 'test_id'

    let stmts: Statement[] = []

    // For this key we will choose remote Tx, such that: Local TM > Remote TX
    stmts.push({
      sql: `INSERT INTO main.parent (id, value, other) VALUES ('1', 'local', null);`,
    })
    stmts.push({
      sql: `INSERT INTO main.parent (id, value, other) VALUES ('2', 'local', null);`,
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
    const {
      runMigrations,
      satellite,
      tableInfo,
      authState,
      adapter,
      getMatchingShadowEntries,
    } = t.context
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
}
