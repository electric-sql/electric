import t, { TestFn } from 'ava'
import Database from 'better-sqlite3'
import type { Database as DB } from 'better-sqlite3'
import { DatabaseAdapter } from '../../src/drivers/better-sqlite3'
import { DatabaseAdapter as DatabaseAdapterInterface } from '@electric-sql/drivers'
import { runInTransaction } from '../../src/util/transactions'

interface Context {
  adapter: DatabaseAdapterInterface
  db: DB
}

const test = t as TestFn<Context>

test.beforeEach(async (t) => {
  const db = new Database(':memory:')
  const adapter = new DatabaseAdapter(db)

  await adapter.runInTransaction(
    {
      sql: "CREATE TABLE IF NOT EXISTS parent('pid' TEXT NOT NULL PRIMARY KEY);",
    },
    {
      sql: "CREATE TABLE IF NOT EXISTS child('cid' TEXT NOT NULL PRIMARY KEY, 'p' TEXT NOT NULL REFERENCES parent(pid));",
    }
  )

  t.context = {
    adapter,
    db,
  }
})

test.afterEach.always(async (t) => {
  const { db } = t.context
  db.close()
})

test('runInTransaction disables FK checks when flag is set to true', async (t) => {
  const { adapter } = t.context

  adapter.run({ sql: 'PRAGMA foreign_keys = ON;' })

  // Should succeed even though the FK is not valid
  // because we pass `true` for the `disableFKs` flag
  const res = await runInTransaction(adapter, true, {
    sql: "INSERT INTO child (cid, p) VALUES ('c1', 'p1');",
  })

  t.is(res.rowsAffected, 1)

  // Check that the row is in the database
  const childRow = await adapter.query({ sql: 'SELECT * FROM child;' })
  t.is(childRow.length, 1)
  t.deepEqual(childRow[0], { cid: 'c1', p: 'p1' })

  // Check that the FK pragma is re-enabled
  const [{ foreign_keys }] = await adapter.query({
    sql: 'PRAGMA foreign_keys;',
  })
  t.is(foreign_keys, 1)
})

test('runInTransaction disables FK checks when flag is set to true and FK pragma is already disabled', async (t) => {
  const { adapter } = t.context

  adapter.run({ sql: 'PRAGMA foreign_keys = OFF;' })

  // Should succeed even though the FK is not valid
  // because we pass `true` for the `disableFKs` flag
  const res = await runInTransaction(adapter, true, {
    sql: "INSERT INTO child (cid, p) VALUES ('c1', 'p1');",
  })

  t.is(res.rowsAffected, 1)

  // Check that the row is in the database
  const childRows = await adapter.query({ sql: 'SELECT * FROM child;' })
  t.is(childRows.length, 1)
  t.deepEqual(childRows[0], { cid: 'c1', p: 'p1' })

  // Check that the FK pragma is still disabled
  const [{ foreign_keys }] = await adapter.query({
    sql: 'PRAGMA foreign_keys;',
  })
  t.is(foreign_keys, 0)
})

test('runInTransaction enables FK checks when flag is set to false', async (t) => {
  const { adapter } = t.context

  adapter.run({ sql: 'PRAGMA foreign_keys = OFF;' })

  // Should fail because the FK is not valid
  // because we pass `false` for the `disableFKs` flag
  await t.throwsAsync(
    runInTransaction(adapter, false, {
      sql: "INSERT INTO child (cid, p) VALUES ('c1', 'p1');",
    }),
    { message: /FOREIGN KEY constraint failed/ }
  )

  const childRows = await adapter.query({ sql: 'SELECT * FROM child;' })
  t.is(childRows.length, 0)

  // Now insert a parent row and a child row pointing to the parent
  await runInTransaction(
    adapter,
    false,
    { sql: "INSERT INTO parent (pid) VALUES ('p1');" },
    { sql: "INSERT INTO child (cid, p) VALUES ('c1', 'p1');" }
  )

  // Check that the rows are in the database
  const parentRows = await adapter.query({ sql: 'SELECT * FROM parent;' })
  t.is(parentRows.length, 1)
  t.deepEqual(parentRows[0], { pid: 'p1' })

  const childRowsAfterInsert = await adapter.query({
    sql: 'SELECT * FROM child;',
  })
  t.is(childRowsAfterInsert.length, 1)
  t.deepEqual(childRowsAfterInsert[0], { cid: 'c1', p: 'p1' })

  // Check that the FK pragma is re-disabled
  const [{ foreign_keys }] = await adapter.query({
    sql: 'PRAGMA foreign_keys;',
  })
  t.is(foreign_keys, 0)
})

test('runInTransaction enables FK checks when flag is set to false and pragma is already enabled', async (t) => {
  const { adapter } = t.context

  adapter.run({ sql: 'PRAGMA foreign_keys = ON;' })

  // Should fail because the FK is not valid
  // because we pass `false` for the `disableFKs` flag
  await t.throwsAsync(
    runInTransaction(adapter, false, {
      sql: "INSERT INTO child (cid, p) VALUES ('c1', 'p1');",
    }),
    { message: /FOREIGN KEY constraint failed/ }
  )

  const childRows = await adapter.query({ sql: 'SELECT * FROM child;' })
  t.is(childRows.length, 0)

  // Now insert a parent row and a child row pointing to the parent
  await runInTransaction(
    adapter,
    false,
    { sql: "INSERT INTO parent (pid) VALUES ('p1');" },
    { sql: "INSERT INTO child (cid, p) VALUES ('c1', 'p1');" }
  )

  // Check that the rows are in the database
  const parentRows = await adapter.query({ sql: 'SELECT * FROM parent;' })
  t.is(parentRows.length, 1)
  t.deepEqual(parentRows[0], { pid: 'p1' })

  const childRowsAfterInsert = await adapter.query({
    sql: 'SELECT * FROM child;',
  })
  t.is(childRowsAfterInsert.length, 1)
  t.deepEqual(childRowsAfterInsert[0], { cid: 'c1', p: 'p1' })

  // Check that the FK pragma is re-enabled
  const [{ foreign_keys }] = await adapter.query({
    sql: 'PRAGMA foreign_keys;',
  })
  t.is(foreign_keys, 1)
})

test('runInTransaction does not touch enabled FK pragma when flag is undefined', async (t) => {
  const { adapter } = t.context

  adapter.run({ sql: 'PRAGMA foreign_keys = ON;' })

  // Should fail because the FK is not valid
  // because we pass `false` for the `disableFKs` flag
  await t.throwsAsync(
    runInTransaction(adapter, undefined, {
      sql: "INSERT INTO child (cid, p) VALUES ('c1', 'p1');",
    }),
    { message: /FOREIGN KEY constraint failed/ }
  )

  const childRows = await adapter.query({ sql: 'SELECT * FROM child;' })
  t.is(childRows.length, 0)

  // Check that the FK pragma is left untouched
  const [{ foreign_keys: fk1 }] = await adapter.query({
    sql: 'PRAGMA foreign_keys;',
  })
  t.is(fk1, 1)

  // Now insert a parent row and a child row pointing to the parent
  await runInTransaction(
    adapter,
    undefined,
    { sql: "INSERT INTO parent (pid) VALUES ('p1');" },
    { sql: "INSERT INTO child (cid, p) VALUES ('c1', 'p1');" }
  )

  // Check that the rows are in the database
  const parentRows = await adapter.query({ sql: 'SELECT * FROM parent;' })
  t.is(parentRows.length, 1)
  t.deepEqual(parentRows[0], { pid: 'p1' })

  const childRowsAfterInsert = await adapter.query({
    sql: 'SELECT * FROM child;',
  })
  t.is(childRowsAfterInsert.length, 1)
  t.deepEqual(childRowsAfterInsert[0], { cid: 'c1', p: 'p1' })

  // Check that the FK pragma is left untouched
  const [{ foreign_keys: fk2 }] = await adapter.query({
    sql: 'PRAGMA foreign_keys;',
  })
  t.is(fk2, 1)
})

test('runInTransaction does not touch disabled FK pragma when flag is undefined', async (t) => {
  const { adapter } = t.context

  adapter.run({ sql: 'PRAGMA foreign_keys = OFF;' })

  // Should succeed even though the FK is not valid
  // because we disabled the FK pragma
  // and passed `undefined` for the `disableFKs` flag
  // which means the FK pragma is used as is
  const res = await runInTransaction(adapter, undefined, {
    sql: "INSERT INTO child (cid, p) VALUES ('c1', 'p1');",
  })

  t.is(res.rowsAffected, 1)

  // Check that the row is in the database
  const childRow = await adapter.query({ sql: 'SELECT * FROM child;' })
  t.is(childRow.length, 1)
  t.deepEqual(childRow[0], { cid: 'c1', p: 'p1' })

  // Check that the FK pragma is still disabled
  const [{ foreign_keys }] = await adapter.query({
    sql: 'PRAGMA foreign_keys;',
  })
  t.is(foreign_keys, 0)
})
