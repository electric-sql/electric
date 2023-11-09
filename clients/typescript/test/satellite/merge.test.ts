import test from 'ava'
import { mergeEntries } from '../../src/satellite/merge.js'
import {
  OplogEntry,
  fromTransaction,
  primaryKeyToStr,
} from '../../src/satellite/oplog.js'
import {
  DEFAULT_LOG_POS,
  DataChangeType,
  DataTransaction,
} from '../../src/util/index.js'
import Long from 'long'
import { relations, migrateDb, personTable } from './common.js'
import Database from 'better-sqlite3'
import { satelliteDefaults } from '../../src/satellite/config.js'

test('merging entries: local no-op updates should cancel incoming delete', (t) => {
  const pk = primaryKeyToStr({ id: 1 })

  const local: OplogEntry[] = [
    {
      rowid: 0,
      namespace: 'main',
      tablename: 'parent',
      optype: 'UPDATE',
      timestamp: '1970-01-02T03:46:41.000Z', // 100001000 as a unix timestamp
      primaryKey: pk,
      newRow: JSON.stringify({ id: 1 }),
      oldRow: undefined,
      clearTags: JSON.stringify(['common@100000000']),
    },
  ]

  const remote: OplogEntry[] = [
    {
      rowid: 0,
      namespace: 'main',
      tablename: 'parent',
      optype: 'DELETE',
      timestamp: '1970-01-02T03:46:42.000Z', // 100002000 as a unix timestamp
      primaryKey: pk,
      oldRow: JSON.stringify({ id: 1, value: 'TEST' }),
      clearTags: JSON.stringify(['common@100000000']),
    },
  ]

  const merged = mergeEntries('local', local, 'remote', remote, relations)

  // Merge should resolve into the UPSERT for this row, since the remote DELETE didn't observe this local update
  t.like(merged, { 'main.parent': { [pk]: { optype: 'UPSERT' } } })
  t.deepEqual(merged['main.parent'][pk].tags, ['local@100001000'])
  t.deepEqual(merged['main.parent'][pk].fullRow, { id: 1, value: 'TEST' })
})

test('merge can handle infinity values', (t) => {
  const pk = primaryKeyToStr({ id: 1 })

  const to_commit_timestamp = (timestamp: string): Long =>
    Long.UZERO.add(new Date(timestamp).getTime())

  const tx1: DataTransaction = {
    lsn: DEFAULT_LOG_POS,
    commit_timestamp: to_commit_timestamp('1970-01-02T03:46:41.000Z'),
    changes: [
      {
        relation: relations.floatTable,
        type: DataChangeType.INSERT,
        record: { id: 1, value: +Infinity },
        tags: [],
      },
    ],
  }

  const tx2: DataTransaction = {
    lsn: DEFAULT_LOG_POS,
    commit_timestamp: to_commit_timestamp('1970-01-02T03:46:42.000Z'),
    changes: [
      {
        relation: relations.floatTable,
        type: DataChangeType.INSERT,
        record: { id: 1, value: -Infinity },
        tags: [],
      },
    ],
  }

  // we go through `fromTransaction` on purpose
  // in order to also test serialisation/deserialisation of the rows
  const entry1: OplogEntry[] = fromTransaction(tx1, relations)
  const entry2: OplogEntry[] = fromTransaction(tx2, relations)

  const merged = mergeEntries('local', entry1, 'remote', entry2, relations)

  // tx2 should win because tx1 and tx2 happened concurrently
  // but the timestamp of tx2 > tx1
  t.like(merged, { 'main.floatTable': { [pk]: { optype: 'UPSERT' } } })
  t.deepEqual(merged['main.floatTable'][pk].fullRow, {
    id: 1,
    value: -Infinity,
  })
})

const to_commit_timestamp = (timestamp: string): Long =>
  Long.UZERO.add(new Date(timestamp).getTime())

test('merge can handle NaN values', (t) => {
  const pk = primaryKeyToStr({ id: 1 })

  const tx1: DataTransaction = {
    lsn: DEFAULT_LOG_POS,
    commit_timestamp: to_commit_timestamp('1970-01-02T03:46:41.000Z'),
    changes: [
      {
        relation: relations.floatTable,
        type: DataChangeType.INSERT,
        record: { id: 1, value: 5.0 },
        tags: [],
      },
    ],
  }

  const tx2: DataTransaction = {
    lsn: DEFAULT_LOG_POS,
    commit_timestamp: to_commit_timestamp('1970-01-02T03:46:42.000Z'),
    changes: [
      {
        relation: relations.floatTable,
        type: DataChangeType.INSERT,
        record: { id: 1, value: NaN },
        tags: [],
      },
    ],
  }

  // we go through `fromTransaction` on purpose
  // in order to also test serialisation/deserialisation of the rows
  const entry1: OplogEntry[] = fromTransaction(tx1, relations)
  const entry2: OplogEntry[] = fromTransaction(tx2, relations)

  const merged = mergeEntries('local', entry1, 'remote', entry2, relations)

  // tx2 should win because tx1 and tx2 happened concurrently
  // but the timestamp of tx2 > tx1
  t.like(merged, { 'main.floatTable': { [pk]: { optype: 'UPSERT' } } })
  t.deepEqual(merged['main.floatTable'][pk].fullRow, { id: 1, value: NaN })
})

test('merge works on oplog entries', (t) => {
  const db = new Database(':memory:')

  // Migrate the DB with the necessary tables and triggers
  migrateDb(db, personTable)

  // Insert a row in the table
  const insertRowSQL = `INSERT INTO ${personTable.tableName} (id, name, age, bmi) VALUES (9e999, 'John Doe', 30, 25.5)`
  db.exec(insertRowSQL)

  // Fetch the oplog entry for the inserted row
  const oplogRows = db
    .prepare(`SELECT * FROM ${satelliteDefaults.oplogTable}`)
    .all()

  t.is(oplogRows.length, 1)

  const oplogEntry = oplogRows[0] as OplogEntry

  // Define a transaction that happened concurrently
  // and inserts a row with the same id but different values
  const tx: DataTransaction = {
    lsn: DEFAULT_LOG_POS,
    commit_timestamp: to_commit_timestamp('1970-01-02T03:46:42.000Z'),
    changes: [
      {
        relation: relations[personTable.tableName as keyof typeof relations],
        type: DataChangeType.INSERT,
        record: { age: 30, bmi: 8e888, id: 9e999, name: 'John Doe' }, // fields must be ordered alphabetically to match the behavior of the triggers
        tags: [],
      },
    ],
  }

  // Merge the oplog entry with the transaction
  const merged = mergeEntries(
    'local',
    [oplogEntry],
    'remote',
    fromTransaction(tx, relations),
    relations
  )

  const pk = primaryKeyToStr({ id: 9e999 })

  // the incoming transaction wins
  t.like(merged, {
    [`main.${personTable.tableName}`]: { [pk]: { optype: 'UPSERT' } },
  })
  t.deepEqual(merged[`main.${personTable.tableName}`][pk].fullRow, {
    id: 9e999,
    name: 'John Doe',
    age: 30,
    bmi: Infinity,
  })
})
