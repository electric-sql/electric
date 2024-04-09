import test, { ExecutionContext } from 'ava'
import { mergeEntries } from '../../src/satellite/merge'
import {
  OplogEntry,
  fromTransaction,
  primaryKeyToStr,
} from '../../src/satellite/oplog'
import {
  DEFAULT_LOG_POS,
  DataChangeType,
  DataTransaction,
  QualifiedTablename,
} from '../../src/util'
import Long from 'long'
import { relations, migrateDb, personTable as getPersonTable } from './common'
import Database from 'better-sqlite3'
import { SatelliteOpts, satelliteDefaults } from '../../src/satellite/config'
import {
  QueryBuilder,
  pgBuilder,
  sqliteBuilder,
} from '../../src/migrators/query-builder'
import { DatabaseAdapter as SQLiteDatabaseAdapter } from '../../src/drivers/better-sqlite3'
import { DatabaseAdapter as PgDatabaseAdapter } from '../../src/drivers/node-postgres/adapter'
import { DatabaseAdapter as DatabaseAdapterInterface } from '../../src/electric/adapter'
import { makePgDatabase } from '../support/node-postgres'
import { randomValue } from '../../src/util/random'

const qualifiedMergeTable = new QualifiedTablename(
  'main',
  'mergeTable'
).toString()

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
  const qualifiedTableName = new QualifiedTablename('main', 'parent').toString()
  t.like(merged, { [qualifiedTableName]: { [pk]: { optype: 'UPSERT' } } })
  t.deepEqual(merged[qualifiedTableName][pk].tags, ['local@100001000'])
  t.deepEqual(merged[qualifiedTableName][pk].fullRow, { id: 1, value: 'TEST' })
})

test('merge can handle infinity values', (t) => {
  _mergeTableTest(t, {
    initial: { real: Infinity },
    incoming: { real: -Infinity },
    expected: { real: -Infinity },
  })
})

test('merge can handle NaN values', (t) => {
  _mergeTableTest(t, {
    initial: { real: 5.0 },
    incoming: { real: NaN },
    expected: { real: NaN },
  })
})

test('merge can handle BigInt (INT8 pgtype) values', (t) => {
  // Big ints are serialized as strings in the oplog
  _mergeTableTest(t, {
    initial: { int8: '3' },
    incoming: { int8: '9223372036854775807' },
    expected: { int8: BigInt('9223372036854775807') },
  })
})

test('merge can handle BigInt (BIGINT pgtype) values', (t) => {
  // Big ints are serialized as strings in the oplog
  _mergeTableTest(t, {
    initial: { bigint: '-5' },
    incoming: { bigint: '-9223372036854775808' },
    expected: { bigint: BigInt('-9223372036854775808') },
  })
})

const to_commit_timestamp = (timestamp: string): Long =>
  Long.UZERO.add(new Date(timestamp).getTime())

/**
 * Merges two secuential transactions over the same row
 * and checks that the value is merged correctly
 * The operation is over the "mergeTable" table in the
 * database schema
 */
function _mergeTableTest(
  t: ExecutionContext,
  opts: {
    initial: Record<string, unknown>
    incoming: Record<string, unknown>
    expected: Record<string, unknown>
  }
) {
  if (opts.initial.id !== undefined) {
    throw new Error('id must not be provided in initial')
  }
  if (opts.incoming.id !== undefined) {
    throw new Error('id must not be provided in incoming')
  }
  if (opts.expected.id !== undefined) {
    throw new Error('id must not be provided in expected')
  }

  const pkId = 1
  const pk = primaryKeyToStr({ id: pkId })

  const tx1: DataTransaction = {
    lsn: DEFAULT_LOG_POS,
    commit_timestamp: to_commit_timestamp('1970-01-02T03:46:41.000Z'),
    changes: [
      {
        relation: relations.mergeTable,
        type: DataChangeType.INSERT,
        record: { ...opts.initial, id: pkId },
        tags: [],
      },
    ],
  }

  const tx2: DataTransaction = {
    lsn: DEFAULT_LOG_POS,
    commit_timestamp: to_commit_timestamp('1970-01-02T03:46:42.000Z'),
    changes: [
      {
        relation: relations.mergeTable,
        type: DataChangeType.INSERT,
        record: { ...opts.incoming, id: pkId },
        tags: [],
      },
    ],
  }

  // we go through `fromTransaction` on purpose
  // in order to also test serialisation/deserialisation of the rows
  const entry1: OplogEntry[] = fromTransaction(tx1, relations, 'main')
  const entry2: OplogEntry[] = fromTransaction(tx2, relations, 'main')

  const merged = mergeEntries('local', entry1, 'remote', entry2, relations)

  // tx2 should win because tx1 and tx2 happened concurrently
  // but the timestamp of tx2 > tx1
  t.like(merged, { [qualifiedMergeTable]: { [pk]: { optype: 'UPSERT' } } })

  t.deepEqual(merged[qualifiedMergeTable][pk].fullRow, {
    ...opts.expected,
    id: pkId,
  })
}

type MaybePromise<T> = T | Promise<T>
type SetupFn = (
  t: ExecutionContext<unknown>
) => MaybePromise<
  [DatabaseAdapterInterface, QueryBuilder, string, SatelliteOpts]
>
const setupSqlite: SetupFn = (t: ExecutionContext<unknown>) => {
  const db = new Database(':memory:')
  t.teardown(() => db.close())
  const namespace = 'main'
  const defaults = satelliteDefaults(namespace)
  return [new SQLiteDatabaseAdapter(db), sqliteBuilder, namespace, defaults]
}

let port = 4800
const setupPG: SetupFn = async (t: ExecutionContext<unknown>) => {
  const dbName = `merge-test-${randomValue()}`
  const { db, stop } = await makePgDatabase(dbName, port++)
  t.teardown(async () => await stop())
  const namespace = 'public'
  const defaults = satelliteDefaults(namespace)
  return [new PgDatabaseAdapter(db), pgBuilder, namespace, defaults]
}

;(
  [
    ['SQLite', setupSqlite],
    ['Postgres', setupPG],
  ] as const
).forEach(([dialect, setup]) => {
  test(`(${dialect}) merge works on oplog entries`, async (t) => {
    const [adapter, builder, namespace, defaults] = await setup(t)

    // Migrate the DB with the necessary tables and triggers
    const personTable = getPersonTable(namespace)
    await migrateDb(adapter, personTable, builder)

    // Insert a row in the table
    const insertRowSQL = `INSERT INTO "${personTable.namespace}"."${
      personTable.tableName
    }" (id, name, age, bmi, int8, blob) VALUES (54321, 'John Doe', 30, 25.5, 7, ${builder.hexValue(
      '0001ff'
    )})`
    await adapter.run({ sql: insertRowSQL })

    // Fetch the oplog entry for the inserted row
    const oplogTable = `"${defaults.oplogTable.namespace}"."${defaults.oplogTable.tablename}"`
    const oplogRows = await adapter.query({
      sql: `SELECT * FROM ${oplogTable}`,
    })

    t.is(oplogRows.length, 1)

    const oplogEntry = oplogRows[0] as unknown as OplogEntry

    // Define a transaction that happened concurrently
    // and inserts a row with the same id but different values
    const tx: DataTransaction = {
      lsn: DEFAULT_LOG_POS,
      commit_timestamp: to_commit_timestamp('1970-01-02T03:46:42.000Z'),
      changes: [
        {
          relation: relations[personTable.tableName as keyof typeof relations],
          type: DataChangeType.INSERT,
          record: {
            // fields must be ordered alphabetically to match the behavior of the triggers
            age: 30,
            blob: new Uint8Array([0, 1, 255]),
            bmi: 21.3,
            id: 54321,
            int8: '224', // Big ints are serialized as strings in the oplog
            name: 'John Doe',
          },
          tags: [],
        },
      ],
    }

    // Merge the oplog entry with the transaction
    const merged = mergeEntries(
      'local',
      [oplogEntry],
      'remote',
      fromTransaction(tx, relations, namespace),
      relations
    )

    const pk = primaryKeyToStr({ id: 54321 })

    // the incoming transaction wins
    const qualifiedTableName = new QualifiedTablename(
      personTable.namespace,
      personTable.tableName
    ).toString()
    t.like(merged, {
      [qualifiedTableName]: { [pk]: { optype: 'UPSERT' } },
    })
    t.deepEqual(merged[qualifiedTableName][pk].fullRow, {
      id: 54321,
      name: 'John Doe',
      age: 30,
      blob: new Uint8Array([0, 1, 255]),
      bmi: 21.3,
      int8: 224n,
    })
  })
})
