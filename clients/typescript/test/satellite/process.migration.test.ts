import testAny, { ExecutionContext, TestFn } from 'ava'
import isequal from 'lodash.isequal'
import Long from 'long'
import {
  SatOpMigrate_Type,
  SatRelation_RelationType,
} from '../../src/_generated/protocol/satellite'
import { DatabaseAdapter } from '../../src/drivers/better-sqlite3'
import { generateTag } from '../../src/satellite/oplog'
import {
  DataChange,
  DataChangeType,
  Row,
  SchemaChange,
  Statement,
  Transaction,
} from '../../src/util'
import {
  ContextType,
  cleanAndStopSatellite,
  makeContext,
  relations,
} from './common'
import { getMatchingShadowEntries } from '../support/satellite-helpers'
import { BundleMigrator } from '../../src/migrators'

type CurrentContext = ContextType<{ clientId: string; txDate: Date }>
const test = testAny as TestFn<CurrentContext>

test.beforeEach(async (t) => {
  await makeContext(t)
  const { satellite, authState } = t.context
  await satellite.start(authState)
  t.context['clientId'] = satellite._authState!.clientId // store clientId in the context
  await populateDB(t)
  const txDate = await satellite._performSnapshot()
  t.context['txDate'] = txDate
  // Mimic Electric sending our own operations back
  // which serves as an acknowledgement (even though there is a separate ack also)
  // and leads to GC of the oplog
  const ackTx = {
    origin: satellite._authState!.clientId,
    commit_timestamp: Long.fromNumber(txDate.getTime()),
    changes: [], // doesn't matter, only the origin and timestamp matter for GC of the oplog
    lsn: new Uint8Array(),
  }
  await satellite._applyTransaction(ackTx)
})
test.afterEach.always(cleanAndStopSatellite)

const populateDB = async (t: ExecutionContext<CurrentContext>) => {
  const adapter = t.context.adapter as DatabaseAdapter

  const stmts: Statement[] = []

  stmts.push({
    sql: `INSERT INTO parent (id, value, other) VALUES (?, ?, ?);`,
    args: [1, 'local', null],
  })
  stmts.push({
    sql: `INSERT INTO parent (id, value, other) VALUES (?, ?, ?);`,
    args: [2, 'local', null],
  })
  await adapter.runInTransaction(...stmts)
}

async function assertDbHasTables(
  t: ExecutionContext<CurrentContext>,
  ...tables: string[]
) {
  const adapter = t.context.adapter as DatabaseAdapter
  const schemaRows = await adapter.query({
    sql: "SELECT tbl_name FROM sqlite_schema WHERE type = 'table'",
  })

  const tableNames = new Set(schemaRows.map((r) => r.tbl_name))
  tables.forEach((tbl) => {
    t.true(tableNames.has(tbl))
  })
}

async function getTableInfo(
  table: string,
  t: ExecutionContext<CurrentContext>
): Promise<ColumnInfo[]> {
  const adapter = t.context.adapter as DatabaseAdapter
  return (await adapter.query({
    sql: `pragma table_info(${table});`,
  })) as ColumnInfo[]
}

type ColumnInfo = {
  cid: number
  name: string
  type: string
  notnull: number
  dflt_value: null | string
  pk: number
}

test.serial('setup populates DB', async (t) => {
  const adapter = t.context.adapter

  const sql = 'SELECT * FROM parent'
  const rows = await adapter.query({ sql })
  t.deepEqual(rows, [
    {
      id: 1,
      value: 'local',
      other: null,
    },
    {
      id: 2,
      value: 'local',
      other: null,
    },
  ])
})

const createTable: SchemaChange = {
  table: {
    name: 'NewTable',
    columns: [{ name: 'id' }, { name: 'foo' }, { name: 'bar' }],
    fks: [],
    pks: ['id'],
  },
  migrationType: SatOpMigrate_Type.CREATE_TABLE,
  sql: 'CREATE TABLE NewTable(\
         id TEXT NOT NULL,\
         foo INTEGER,\
         bar TEXT,\
         PRIMARY KEY(id)\
       );',
}

const addColumn: SchemaChange = {
  table: {
    name: 'parent',
    columns: [
      { name: 'id' },
      { name: 'value' },
      { name: 'other' },
      { name: 'baz' },
    ],
    fks: [],
    pks: ['id'],
  },
  migrationType: SatOpMigrate_Type.ALTER_ADD_COLUMN,
  sql: 'ALTER TABLE parent ADD baz TEXT',
}

const addColumnRelation = {
  id: 2000, // doesn't matter
  schema: 'public',
  table: 'parent',
  tableType: SatRelation_RelationType.TABLE,
  columns: [
    {
      name: 'id',
      type: 'INTEGER',
      isNullable: false,
      primaryKey: true,
    },
    {
      name: 'value',
      type: 'TEXT',
      isNullable: true,
      primaryKey: false,
    },
    {
      name: 'other',
      type: 'INTEGER',
      isNullable: true,
      primaryKey: false,
    },
    {
      name: 'baz',
      type: 'TEXT',
      isNullable: true,
      primaryKey: false,
    },
  ],
}
const newTableRelation = {
  id: 2001, // doesn't matter
  schema: 'public',
  table: 'NewTable',
  tableType: SatRelation_RelationType.TABLE,
  columns: [
    {
      name: 'id',
      type: 'TEXT',
      isNullable: false,
      primaryKey: true,
    },
    {
      name: 'foo',
      type: 'INTEGER',
      isNullable: true,
      primaryKey: false,
    },
    {
      name: 'bar',
      type: 'TEXT',
      isNullable: true,
      primaryKey: false,
    },
  ],
}

async function checkMigrationIsApplied(t: ExecutionContext<CurrentContext>) {
  await assertDbHasTables(t, 'parent', 'child', 'NewTable')

  const newTableInfo = await getTableInfo('NewTable', t)

  t.deepEqual(newTableInfo, [
    // id, foo, bar
    { cid: 0, name: 'id', type: 'TEXT', notnull: 1, dflt_value: null, pk: 1 },
    {
      cid: 1,
      name: 'foo',
      type: 'INTEGER',
      notnull: 0,
      dflt_value: null,
      pk: 0,
    },
    { cid: 2, name: 'bar', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0 },
  ])

  const parentTableInfo = await getTableInfo('parent', t)
  const parentTableHasColumn = parentTableInfo.some((col: ColumnInfo) => {
    return (
      col.name === 'baz' &&
      col.type === 'TEXT' &&
      col.notnull === 0 &&
      col.dflt_value === null &&
      col.pk === 0
    )
  })

  t.true(parentTableHasColumn)
}

const fetchParentRows = async (adapter: DatabaseAdapter): Promise<Row[]> => {
  return adapter.query({
    sql: 'SELECT * FROM parent',
  })
}

const testSetEquality = <T>(t: ExecutionContext, xs: T[], ys: T[]): void => {
  t.is(xs.length, ys.length, 'Expected array lengths to be equal')

  const missing: T[] = []

  for (const x of xs) {
    if (ys.some((y) => isequal(x, y))) continue
    else missing.push(x)
  }

  t.deepEqual(
    missing,
    [],
    'Expected all elements from the first array to be present in the second, but some are missing'
  )
}

test.serial('apply migration containing only DDL', async (t) => {
  const { satellite, adapter, txDate } = t.context
  const timestamp = txDate.getTime()

  const rowsBeforeMigration = await fetchParentRows(adapter)

  const migrationTx = {
    origin: 'remote',
    commit_timestamp: Long.fromNumber(timestamp),
    changes: [createTable, addColumn],
    lsn: new Uint8Array(),
    // starts at 3, because the app already defines 2 migrations
    // (see test/support/migrations/migrations.js)
    // which are loaded when Satellite is started
    migrationVersion: '3',
  }

  // Apply the migration transaction
  await satellite._applyTransaction(migrationTx)

  // Check that the migration was successfully applied
  await checkMigrationIsApplied(t)

  // Check that the existing rows are still there and are unchanged
  const rowsAfterMigration = await fetchParentRows(adapter)
  const expectedRowsAfterMigration = rowsBeforeMigration.map((row: Row) => {
    return {
      ...row,
      baz: null,
    }
  })

  t.deepEqual(rowsAfterMigration, expectedRowsAfterMigration)
})

test.serial(
  'apply migration containing DDL and non-conflicting DML',
  async (t) => {
    /*
     Test migrations containing non-conflicting DML statements and some DDL statements
     - Process the following migration tx: <DML 1> <DDL 1> <DML 2>
        - DML 1 is:
           insert non-conflicting row in existing table
           non-conflict update to existing row
           delete row
        - DDL 1 is:
            Add column to table that is affected by the statements in DML 1
            Create new table
        - DML 2 is:
            insert row in extended table with value for new column
            insert row in extended table without a value for the new column
            Insert some rows in newly created table
     - Check that the migration was successfully applied on the local DB
     - Check the modifications (insert, update, delete) to the rows
    */

    const { satellite, adapter, txDate } = t.context
    const timestamp = txDate.getTime()

    const txTags = [generateTag('remote', txDate)]
    const mkInsertChange = (record: any) => {
      return {
        type: DataChangeType.INSERT,
        relation: relations['parent'],
        record: record,
        oldRecord: {},
        tags: txTags,
      }
    }

    const insertRow = {
      id: 3,
      value: 'remote',
      other: 1,
    }

    const insertChange = mkInsertChange(insertRow)

    const oldUpdateRow = {
      id: 1,
      value: 'local',
      other: null,
    }

    const updateRow = {
      id: 1,
      value: 'remote',
      other: 5,
    }

    const updateChange = {
      //type: DataChangeType.INSERT, // insert since `opLogEntryToChange` also transforms update optype into insert
      type: DataChangeType.UPDATE,
      relation: relations['parent'],
      record: updateRow,
      oldRecord: oldUpdateRow,
      tags: txTags,
    }

    // Delete overwrites the insert for row with id 2
    // Thus, it overwrites the shadow tag for that row
    const localEntries = await satellite._getEntries()
    const shadowEntryForRow2 = await getMatchingShadowEntries(
      adapter,
      localEntries[1]
    ) // shadow entry for insert of row with id 2
    const shadowTagsRow2 = JSON.parse(shadowEntryForRow2[0].tags)

    const deleteRow = {
      id: 2,
      value: 'local',
      other: null,
    }

    const deleteChange = {
      type: DataChangeType.DELETE,
      relation: relations['parent'],
      oldRecord: deleteRow,
      tags: shadowTagsRow2,
    }

    const insertExtendedRow = {
      id: 4,
      value: 'remote',
      other: 6,
      baz: 'foo',
    }
    const insertExtendedChange = {
      type: DataChangeType.INSERT,
      relation: addColumnRelation,
      record: insertExtendedRow,
      oldRecord: {},
      tags: txTags,
    }

    const insertExtendedWithoutValueRow = {
      id: 5,
      value: 'remote',
      other: 7,
    }
    const insertExtendedWithoutValueChange = {
      type: DataChangeType.INSERT,
      relation: addColumnRelation,
      record: insertExtendedWithoutValueRow,
      oldRecord: {},
      tags: txTags,
    }

    const insertInNewTableRow = {
      id: '1',
      foo: 1,
      bar: '2',
    }
    const insertInNewTableChange = {
      type: DataChangeType.INSERT,
      relation: newTableRelation,
      record: insertInNewTableRow,
      oldRecord: {},
      tags: txTags,
    }

    const dml1 = [insertChange, updateChange, deleteChange]
    const ddl1 = [addColumn, createTable]
    const dml2 = [
      insertExtendedChange,
      insertExtendedWithoutValueChange,
      insertInNewTableChange,
    ]

    const migrationTx = {
      origin: 'remote',
      commit_timestamp: Long.fromNumber(timestamp),
      changes: [...dml1, ...ddl1, ...dml2],
      lsn: new Uint8Array(),
      migrationVersion: '4',
    }

    const rowsBeforeMigration = await fetchParentRows(adapter)

    // For each schema change, Electric sends a `SatRelation` message
    // before sending a DML operation that depends on a new or modified schema.
    // The `SatRelation` message is handled by `_updateRelations` in order
    // to update Satellite's relations
    await satellite._updateRelations(addColumnRelation)
    await satellite._updateRelations(newTableRelation)

    // Apply the migration transaction
    await satellite._applyTransaction(migrationTx)

    // Check that the migration was successfully applied
    await checkMigrationIsApplied(t)

    // Check that the existing rows are still there and are unchanged
    const rowsAfterMigration = await fetchParentRows(adapter)
    const expectedRowsAfterMigration = rowsBeforeMigration
      .filter((r: Row) => r.id !== deleteRow.id && r.id !== oldUpdateRow.id)
      .concat([insertRow, updateRow, insertExtendedWithoutValueRow])
      .map((row: Row) => {
        return {
          ...row,
          baz: null,
        } as Row
      })
      .concat([insertExtendedRow])
    testSetEquality(t, rowsAfterMigration, expectedRowsAfterMigration)

    // Check the row that was inserted in the new table
    const newTableRows = await adapter.query({
      sql: 'SELECT * FROM NewTable',
    })

    t.is(newTableRows.length, 1)
    t.deepEqual(newTableRows[0], insertInNewTableRow)
  }
)

test.serial('apply migration containing DDL and conflicting DML', async (t) => {
  // Same as previous test but DML contains some conflicting operations
  const { satellite, adapter, txDate } = t.context

  // Fetch the shadow tag for row 1 such that delete will overwrite it
  const localEntries = await satellite._getEntries()
  const shadowEntryForRow1 = await getMatchingShadowEntries(
    adapter,
    localEntries[0]
  ) // shadow entry for insert of row with id 1
  const shadowTagsRow1 = JSON.parse(shadowEntryForRow1[0].tags)

  // Locally update row with id 1
  await adapter.runInTransaction({
    sql: `UPDATE parent SET value = ?, other = ? WHERE id = ?;`,
    args: ['still local', 5, 1],
  })

  await satellite._performSnapshot()

  // Now receive a concurrent delete of that row
  // such that it deletes the row with id 1 that was initially inserted
  const timestamp = txDate.getTime()
  //const txTags = [ generateTag('remote', txDate) ]

  const deleteRow = {
    id: 1,
    value: 'local',
    other: null,
  }

  const deleteChange = {
    type: DataChangeType.DELETE,
    relation: relations['parent'],
    oldRecord: deleteRow,
    tags: shadowTagsRow1,
  }

  // Process the incoming delete
  const ddl = [addColumn, createTable]
  const dml = [deleteChange]

  const migrationTx = {
    origin: 'remote',
    commit_timestamp: Long.fromNumber(timestamp),
    changes: [...ddl, ...dml],
    lsn: new Uint8Array(),
    migrationVersion: '5',
  }

  const rowsBeforeMigration = await fetchParentRows(adapter)
  const rowsBeforeMigrationExceptConflictingRow = rowsBeforeMigration.filter(
    (r) => r.id !== deleteRow.id
  )

  // For each schema change, Electric sends a `SatRelation` message
  // before sending a DML operation that depends on a new or modified schema.
  // The `SatRelation` message is handled by `_updateRelations` in order
  // to update Satellite's relations.
  // In this case, the DML operation deletes a row in `parent` table
  // so we receive a `SatRelation` message for that table
  await satellite._updateRelations(addColumnRelation)

  // Apply the migration transaction
  await satellite._applyTransaction(migrationTx)

  // Check that the migration was successfully applied
  await checkMigrationIsApplied(t)

  // The local update and remote delete happened concurrently
  // Check that the update wins
  const rowsAfterMigration = await fetchParentRows(adapter)
  const newRowsExceptConflictingRow = rowsAfterMigration.filter(
    (r) => r.id !== deleteRow.id
  )
  const conflictingRow = rowsAfterMigration.find((r) => r.id === deleteRow.id)

  testSetEquality(
    t,
    rowsBeforeMigrationExceptConflictingRow.map((r) => {
      return {
        baz: null,
        ...r,
      }
    }),
    newRowsExceptConflictingRow
  )

  t.deepEqual(conflictingRow, {
    id: 1,
    value: 'still local',
    other: 5,
    baz: null,
  })
})

test.serial('apply migration and concurrent transaction', async (t) => {
  const { satellite, adapter, txDate } = t.context

  const timestamp = txDate.getTime()
  const remoteA = 'remoteA'
  const remoteB = 'remoteB'
  const txTagsRemoteA = [generateTag(remoteA, txDate)]
  const txTagsRemoteB = [generateTag(remoteB, txDate)]

  const mkInsertChange = (
    record: Record<string, string | number>,
    tags: string[]
  ): DataChange => {
    return {
      type: DataChangeType.INSERT,
      relation: relations['parent'],
      record: record,
      oldRecord: {},
      tags: tags,
    }
  }

  const insertRowA = {
    id: 3,
    value: 'remote A',
    other: 8,
  }

  const insertRowB = {
    id: 3,
    value: 'remote B',
    other: 9,
  }

  // Make 2 concurrent insert changes.
  // They are concurrent because both remoteA and remoteB
  // generated the changes at `timestamp`
  const insertChangeA = mkInsertChange(insertRowA, txTagsRemoteA)
  const insertChangeB = mkInsertChange(insertRowB, txTagsRemoteB)

  const txA: Transaction = {
    origin: remoteA,
    commit_timestamp: Long.fromNumber(timestamp),
    changes: [insertChangeA],
    lsn: new Uint8Array(),
  }

  const ddl = [addColumn, createTable]

  const txB: Transaction = {
    origin: remoteB,
    commit_timestamp: Long.fromNumber(timestamp),
    changes: [...ddl, insertChangeB],
    lsn: new Uint8Array(),
    migrationVersion: '6',
  }

  const rowsBeforeMigration = await fetchParentRows(adapter)

  // For each schema change, Electric sends a `SatRelation` message
  // before sending a DML operation that depends on a new or modified schema.
  // The `SatRelation` message is handled by `_updateRelations` in order
  // to update Satellite's relations.
  // In this case, the DML operation adds a row in `parent` table
  // so we receive a `SatRelation` message for that table
  await satellite._updateRelations(addColumnRelation)

  // Apply the concurrent transactions
  await satellite._applyTransaction(txB)
  await satellite._applyTransaction(txA)

  // Check that the migration was successfully applied
  await checkMigrationIsApplied(t)

  // Check that one of the two insertions won
  const rowsAfterMigration = await fetchParentRows(adapter)
  const extendRow = (r: Row) => {
    return {
      ...r,
      baz: null,
    }
  }
  const extendedRows = rowsBeforeMigration.map(extendRow)

  // Check that all rows now have an additional column
  t.deepEqual(
    rowsAfterMigration.filter((r) => r.id !== insertRowA.id),
    extendedRows
  )

  const conflictingRow = rowsAfterMigration.find((r) => r.id === insertRowA.id)

  // Now also check the row that was concurrently inserted
  t.assert(
    isequal(conflictingRow, extendRow(insertRowA)) ||
      isequal(conflictingRow, extendRow(insertRowB))
  )
})

const migrationWithFKs: SchemaChange[] = [
  {
    migrationType: SatOpMigrate_Type.CREATE_TABLE,
    sql: `
    CREATE TABLE "test_items" (
      "id" TEXT NOT NULL,
      CONSTRAINT "test_items_pkey" PRIMARY KEY ("id")
    ) WITHOUT ROWID;
    `,
    table: {
      name: 'test_items',
      columns: [{ name: 'id' }],
      fks: [],
      pks: ['id'],
    },
  },
  {
    migrationType: SatOpMigrate_Type.CREATE_TABLE,
    sql: `
    CREATE TABLE "test_other_items" (
      "id" TEXT NOT NULL,
      "item_id" TEXT,
      -- CONSTRAINT "test_other_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "test_items" ("id"),
      CONSTRAINT "test_other_items_pkey" PRIMARY KEY ("id")
    ) WITHOUT ROWID;
    `,
    table: {
      name: 'test_other_items',
      columns: [{ name: 'id' }, { name: 'item_id' }],
      fks: [
        {
          $type: 'Electric.Satellite.SatOpMigrate.ForeignKey',
          fkCols: ['item_id'],
          pkTable: 'test_items',
          pkCols: ['id'],
        },
      ],
      pks: ['id'],
    },
  },
]

test.serial('apply another migration', async (t) => {
  const { satellite } = t.context

  const migrationTx = {
    origin: 'remote',
    commit_timestamp: Long.fromNumber(new Date().getTime()),
    changes: migrationWithFKs,
    lsn: new Uint8Array(),
    // starts at 3, because the app already defines 2 migrations
    // (see test/support/migrations/migrations.js)
    // which are loaded when Satellite is started
    migrationVersion: '3',
  }

  // Apply the migration transaction
  try {
    await satellite._applyTransaction(migrationTx)
  } catch (e) {
    console.error(e)
    throw e
  }

  await assertDbHasTables(t, 'test_items', 'test_other_items')
  t.pass()
})

test.serial('store applied migrations', async (t) => {
  const { satellite, client } = t.context

  const newTableRelation = {
    id: 2001, // doesn't matter
    schema: 'public',
    table: 'NewTable',
    tableType: SatRelation_RelationType.TABLE,
    columns: [
      {
        name: 'id',
        type: 'TEXT',
        isNullable: false,
        primaryKey: true,
      },
    ],
  }

  const migrationVersion = '4'
  const migrationTx: Transaction = {
    commit_timestamp: Long.ZERO,
    lsn: new Uint8Array(),
    changes: [],
    migrationVersion: migrationVersion,
  }

  client.setRelations({
    NewTable: newTableRelation,
  })

  client.setTransactions([migrationTx])

  // Allow a second for the transaction to be applied
  const startTime = Date.now()
  const endTime = startTime + 1000
  let observed = false

  while (Date.now() < endTime && !observed) {
    const migrator = satellite.migrator as BundleMigrator
    const appliedMigrations = await migrator.queryApplied()
    const appliedVersions = appliedMigrations.map((m) => m.version)
    observed = appliedVersions.includes(migrationVersion)
  }

  t.assert(observed)
})
