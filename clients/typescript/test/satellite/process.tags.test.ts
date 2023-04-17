import { mkdir, rm as removeFile } from 'node:fs/promises'

import test from 'ava'

import Database from 'better-sqlite3'
import { DatabaseAdapter } from '../../src/drivers/better-sqlite3/adapter'

import { MockSatelliteClient } from '../../src/satellite/mock'
import { BundleMigrator } from '../../src/migrators/bundle'
import { MockNotifier } from '../../src/notifiers/mock'
import { MockConsoleClient } from '../../src/auth/mock'
import { randomValue } from '../../src/util/random'

import {
  OPTYPES,
  generateTag,
  encodeTags,
  //decodeTags,
} from '../../src/satellite/oplog'
import { SatelliteConfig, satelliteDefaults } from '../../src/satellite/config'
import { SatelliteProcess } from '../../src/satellite/process'

import {
  initTableInfo,
  generateRemoteOplogEntry,
  genEncodedTags,
} from '../support/satellite-helpers'
import { Statement } from '../../src/util/types'

import config from '../support/.electric/@config/index'
const { migrations } = config

// Speed up the intervals for testing.
const opts = Object.assign({}, satelliteDefaults, {
  minSnapshotWindow: 40,
  pollingInterval: 200,
})

const satelliteConfig: SatelliteConfig = {
  app: 'test',
  env: 'default',
}

test.beforeEach(async (t) => {
  await mkdir('.tmp', { recursive: true })
  const dbName = `.tmp/test-${randomValue()}.db`
  const db = new Database(dbName)
  const adapter = new DatabaseAdapter(db)
  const migrator = new BundleMigrator(adapter, migrations)
  const notifier = new MockNotifier(dbName)
  const client = new MockSatelliteClient()
  const console = new MockConsoleClient()
  const satellite = new SatelliteProcess(
    dbName,
    adapter,
    migrator,
    notifier,
    client,
    console,
    satelliteConfig,
    opts
  )

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
    timestamp,
  }
})

test.afterEach.always(async (t) => {
  const { dbName, satellite } = t.context as any

  await removeFile(dbName, { force: true })
  await removeFile(`${dbName}-journal`, { force: true })

  await satellite.stop()
})

test('basic rules for setting tags', async (t) => {
  const { adapter, runMigrations, satellite } = t.context as any
  await runMigrations()

  await satellite._setAuthState()
  const clientId = satellite['_authState']['clientId']

  await adapter.run({
    sql: `INSERT INTO parent(id, value, other) VALUES (1, 'local', null)`,
  })

  const txDate1 = await satellite._performSnapshot()
  let shadow = await satellite._getOplogShadowEntry()
  t.is(shadow.length, 1)
  t.is(shadow[0].tags, genEncodedTags(clientId, [txDate1]))

  await adapter.run({
    sql: `UPDATE parent SET value = 'local1', other = 'other1' WHERE id = 1`,
  })

  const txDate2 = await satellite._performSnapshot()
  shadow = await satellite._getOplogShadowEntry()
  t.is(shadow.length, 1)
  t.is(shadow[0].tags, genEncodedTags(clientId, [txDate2]))

  await adapter.run({
    sql: `UPDATE parent SET value = 'local2', other = 'other2' WHERE id = 1`,
  })

  const txDate3 = await satellite._performSnapshot()
  shadow = await satellite._getOplogShadowEntry()
  t.is(shadow.length, 1)
  t.is(shadow[0].tags, genEncodedTags(clientId, [txDate3]))

  await adapter.run({
    sql: `DELETE FROM parent WHERE id = 1`,
  })

  const txDate4 = await satellite._performSnapshot()
  shadow = await satellite._getOplogShadowEntry()
  t.is(shadow.length, 0)

  let entries = await satellite._getEntries()
  //console.log(entries)
  t.is(entries[0].clearTags, encodeTags([]))
  t.is(entries[1].clearTags, genEncodedTags(clientId, [txDate1]))
  t.is(entries[2].clearTags, genEncodedTags(clientId, [txDate2]))
  t.is(entries[3].clearTags, genEncodedTags(clientId, [txDate3]))

  t.not(txDate1, txDate2)
  t.not(txDate2, txDate3)
  t.not(txDate3, txDate4)
})

test('TX1=INSERT, TX2=DELETE, TX3=INSERT, ack TX1', async (t) => {
  const { adapter, runMigrations, satellite, tableInfo } = t.context as any
  await runMigrations()
  await satellite._setAuthState()

  const clientId = satellite['_authState']['clientId']

  // Local INSERT
  const stmts1 = {
    sql: `INSERT INTO parent (id, value, other) VALUES (?, ?, ?)`,
    args: ['1', 'local', null],
  }
  await adapter.runInTransaction(stmts1)
  const txDate1 = await satellite._performSnapshot()

  const localEntries1 = await satellite._getEntries()
  const shadowEntry1 = await satellite._getOplogShadowEntry(localEntries1[0])

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
    sql: `DELETE FROM parent WHERE id=?`,
    args: ['1'],
  }
  await adapter.runInTransaction(stmts2)
  const txDate2 = await satellite._performSnapshot()

  const localEntries2 = await satellite._getEntries()
  const shadowEntry2 = await satellite._getOplogShadowEntry(localEntries2[1])

  // shadowTag is empty
  t.is(0, shadowEntry2.length)
  // clearTags contains previous shadowTag
  t.like(localEntries2[1], {
    clearTags: tag1,
    timestamp: txDate2.toISOString(),
  })

  // Local INSERT
  const stmts3 = {
    sql: `INSERT INTO parent (id, value, other) VALUES (?, ?, ?)`,
    args: ['1', 'local', null],
  }
  await adapter.runInTransaction(stmts3)
  const txDate3 = await satellite._performSnapshot()

  const localEntries3 = await satellite._getEntries()
  const shadowEntry3 = await satellite._getOplogShadowEntry(localEntries3[1])

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
    txDate1,
    tag1,
    {
      id: 1,
      value: 'local',
      other: null,
    },
    undefined
  )

  await satellite._applyTransactionInternal(
    clientId,
    txDate1,
    [ackEntry],
    new Uint8Array()
  )

  // validat that garbage collection have triggered
  t.is(2, (await satellite._getEntries()).length)

  let shadow = await satellite._getOplogShadowEntry()
  t.like(
    shadow[0],
    {
      tags: genEncodedTags(clientId, [txDate3]),
    },
    'error: tag1 was reintroduced after merging acked operation'
  )
})

test('remote tx (INSERT) concurrently with local tx (INSERT -> DELETE)', async (t) => {
  const { adapter, runMigrations, satellite, tableInfo } = t.context as any
  await runMigrations()
  await satellite._setAuthState()

  let stmts: Statement[] = []

  // For this key we will choose remote Tx, such that: Local TM > Remote TX
  stmts.push({
    sql: `INSERT INTO parent (id, value, other) VALUES (?, ?, ?);`,
    args: ['1', 'local', null],
  })
  stmts.push({ sql: `DELETE FROM parent WHERE id = 1` })
  // For this key we will choose remote Tx, such that: Local TM < Remote TX
  stmts.push({
    sql: `INSERT INTO parent (id, value, other) VALUES (?, ?, ?);`,
    args: ['2', 'local', null],
  })
  stmts.push({ sql: `DELETE FROM parent WHERE id = 2` })
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

  await satellite._apply([prevEntry], 'remote')
  await satellite._apply([nextEntry], 'remote')

  let shadow = await satellite._getOplogShadowEntry()
  const expectedShadow = [
    {
      namespace: 'main',
      tablename: 'parent',
      primaryKey: 1,
      tags: genEncodedTags('remote', [prevTs]),
    },
    {
      namespace: 'main',
      tablename: 'parent',
      primaryKey: 2,
      tags: genEncodedTags('remote', [nextTs]),
    },
  ]
  t.deepEqual(shadow, expectedShadow)

  //let entries= await satellite._getEntries()
  //console.log(entries)
  let userTable = await adapter.query({ sql: `SELECT * FROM parent;` })
  //console.log(table)

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
  const { adapter, runMigrations, satellite, tableInfo } = t.context as any
  await runMigrations()
  await satellite._setAuthState()

  let stmts: Statement[] = []

  // For this key we will choose remote Tx, such that: Local TM > Remote TX
  stmts.push({
    sql: `INSERT INTO parent (id, value, other) VALUES (?, ?, ?);`,
    args: ['1', 'local', null],
  })
  stmts.push({
    sql: `INSERT INTO parent (id, value, other) VALUES (?, ?, ?);`,
    args: ['2', 'local', null],
  })
  await adapter.runInTransaction(...stmts)
  const txDate1 = await satellite._performSnapshot()

  stmts = []
  // For this key we will choose remote Tx, such that: Local TM < Remote TX
  stmts.push({ sql: `DELETE FROM parent WHERE id = 1` })
  stmts.push({ sql: `DELETE FROM parent WHERE id = 2` })
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

  await satellite._apply([prevEntry], 'remote')
  await satellite._apply([nextEntry], 'remote')

  let shadow = await satellite._getOplogShadowEntry()
  const expectedShadow = [
    {
      namespace: 'main',
      tablename: 'parent',
      primaryKey: 1,
      tags: genEncodedTags('remote', [prevTs]),
    },
    {
      namespace: 'main',
      tablename: 'parent',
      primaryKey: 2,
      tags: genEncodedTags('remote', [nextTs]),
    },
  ]
  t.deepEqual(shadow, expectedShadow)

  //let entries= await satellite._getEntries()
  //console.log(entries)
  let userTable = await adapter.query({ sql: `SELECT * FROM parent;` })
  //console.log(table)

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
  const { adapter, runMigrations, satellite, tableInfo } = t.context as any
  await runMigrations()
  await satellite._setAuthState()
  const clientId = satellite['_authState']['clientId']
  let stmts: Statement[] = []

  // For this key we will choose remote Tx, such that: Local TM > Remote TX
  stmts.push({
    sql: `INSERT INTO parent (id, value, other) VALUES (?, ?, ?);`,
    args: ['1', 'local', null],
  })
  stmts.push({
    sql: `UPDATE parent SET value = ?, other = ? WHERE id = 1`,
    args: ['local', 'not_null'],
  })
  // For this key we will choose remote Tx, such that: Local TM < Remote TX
  stmts.push({
    sql: `INSERT INTO parent (id, value, other) VALUES (?, ?, ?);`,
    args: ['2', 'local', null],
  })
  stmts.push({
    sql: `UPDATE parent SET value = ?, other = ? WHERE id = 1`,
    args: ['local', 'not_null'],
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

  await satellite._apply([prevEntry], 'remote')
  await satellite._apply([nextEntry], 'remote')

  let shadow = await satellite._getOplogShadowEntry()
  const expectedShadow = [
    {
      namespace: 'main',
      tablename: 'parent',
      primaryKey: 1,
      tags: encodeTags([
        generateTag(clientId, new Date(txDate1)),
        generateTag('remote', new Date(prevTs)),
      ]),
    },
    {
      namespace: 'main',
      tablename: 'parent',
      primaryKey: 2,
      tags: encodeTags([
        generateTag(clientId, new Date(txDate1)),
        generateTag('remote', new Date(nextTs)),
      ]),
    },
  ]
  t.deepEqual(shadow, expectedShadow)

  let entries = await satellite._getEntries()
  //console.log(entries)

  // Given that Insert and Update happen within the same transaction clear should not
  // contain itself
  t.is(entries[0].clearTags, encodeTags([]))
  t.is(entries[1].clearTags, encodeTags([]))
  t.is(entries[2].clearTags, encodeTags([]))
  t.is(entries[3].clearTags, encodeTags([]))

  let userTable = await adapter.query({ sql: `SELECT * FROM parent;` })

  // In both cases insert wins over delete, but
  // for id = 1 CR picks local data before delete, while
  // for id = 2 CR picks remote data
  const expectedUserTable = [
    { id: 1, value: 'local', other: 'not_null' },
    { id: 2, value: 'remote', other: 2 },
  ]
  t.deepEqual(expectedUserTable, userTable)
})

test('origin tx (INSERT) concurrently with local txses (INSERT -> DELETE)', async (t) => {
  //
  const { adapter, runMigrations, satellite, tableInfo } = t.context as any
  await runMigrations()
  await satellite._setAuthState()
  const clientId = satellite['_authState']['clientId']

  let stmts: Statement[] = []

  // For this key we will choose remote Tx, such that: Local TM > Remote TX
  stmts.push({
    sql: `INSERT INTO parent (id, value, other) VALUES (?, ?, ?);`,
    args: ['1', 'local', null],
  })
  stmts.push({
    sql: `INSERT INTO parent (id, value, other) VALUES (?, ?, ?);`,
    args: ['2', 'local', null],
  })
  await adapter.runInTransaction(...stmts)
  const txDate1 = await satellite._performSnapshot()

  stmts = []
  // For this key we will choose remote Tx, such that: Local TM < Remote TX
  stmts.push({ sql: `DELETE FROM parent WHERE id = 1` })
  stmts.push({ sql: `DELETE FROM parent WHERE id = 2` })
  await adapter.runInTransaction(...stmts)
  await satellite._performSnapshot()

  let entries = await satellite._getEntries()
  //console.log(entries)

  // For this key we receive transaction which was older
  let electricEntrySame = generateRemoteOplogEntry(
    tableInfo,
    entries[0].namespace,
    entries[0].tablename,
    OPTYPES.insert,
    new Date(entries[0].timestamp).getTime(),
    genEncodedTags(clientId, [txDate1]),
    JSON.parse(entries[0].newRow),
    undefined
  )

  // For this key we had concurrent insert transaction from another node `remote`
  // with same timestamp
  let electricEntryConflict = generateRemoteOplogEntry(
    tableInfo,
    entries[1].namespace,
    entries[1].tablename,
    OPTYPES.insert,
    new Date(entries[1].timestamp).getTime(),
    encodeTags([
      generateTag(clientId, txDate1),
      generateTag('remote', txDate1),
    ]),
    JSON.parse(entries[1].newRow),
    undefined
  )

  await satellite._apply([electricEntrySame, electricEntryConflict], clientId)

  let shadow = await satellite._getOplogShadowEntry()
  const expectedShadow = [
    {
      namespace: 'main',
      tablename: 'parent',
      primaryKey: 2,
      tags: genEncodedTags('remote', [txDate1]),
    },
  ]
  t.deepEqual(shadow, expectedShadow)

  let userTable = await adapter.query({ sql: `SELECT * FROM parent;` })
  const expectedUserTable = [{ id: 2, value: 'local', other: null }]
  t.deepEqual(expectedUserTable, userTable)
})

test('local (INSERT -> UPDATE -> DELETE) with remote equivalent', async (t) => {
  const { runMigrations, satellite, tableInfo } = t.context as any
  await runMigrations()
  await satellite._setAuthState()
  const clientId = satellite['_authState']['clientId']
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

  const deleteEntry = generateRemoteOplogEntry(
    tableInfo,
    'main',
    'parent',
    OPTYPES.delete,
    txDate1 + 1,
    genEncodedTags('remote', []),
    {
      id: 1,
      value: 'local',
    },
    undefined
  )

  await satellite._apply([insertEntry], clientId)

  let shadow = await satellite._getOplogShadowEntry()
  const expectedShadow = [
    {
      namespace: 'main',
      tablename: 'parent',
      primaryKey: 1,
      tags: genEncodedTags('remote', [txDate1]),
    },
  ]
  t.deepEqual(shadow, expectedShadow)

  await satellite._apply([deleteEntry], clientId)

  shadow = await satellite._getOplogShadowEntry()
  t.deepEqual([], shadow)

  let entries = await satellite._getEntries(0)
  t.deepEqual([], entries)
})
