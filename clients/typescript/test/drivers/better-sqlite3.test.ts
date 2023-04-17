import test from 'ava'

import Database from 'better-sqlite3'
import { MockConsoleClient } from '../../src/auth/mock'

import { DatabaseAdapter } from '../../src/drivers/better-sqlite3/adapter'
import { electrify } from '../../src/drivers/better-sqlite3/index'
import { MockDatabase } from '../../src/drivers/better-sqlite3/mock'
import { MockNotifier } from '../../src/notifiers/mock'
import { MockRegistry } from '../../src/satellite/mock'
import { QualifiedTablename } from '../../src/util/tablename'

const config = { app: 'app', env: 'default', migrations: [] }
const dbFilename = 'test.db'

const getNewOpts = () => ({
  notifier: new MockNotifier(dbFilename),
  registry: new MockRegistry(),
  console: new MockConsoleClient(),
})

test('electrify returns an equivalent database client', async (t) => {
  const original = new Database('test.db')
  const registry = new MockRegistry()
  const console = new MockConsoleClient()
  const db = await electrify(original, config, { registry, console })

  const originalKeys = Object.getOwnPropertyNames(original)
  const originalPrototype = Object.getPrototypeOf(original)
  const allKeys = originalKeys.concat(Object.keys(originalPrototype))
  allKeys.forEach((key) => {
    t.assert(key in db)
  })
})

test('electrify does not remove non-patched properties and methods', async (t) => {
  const original = new Database('test.db')
  const opts = getNewOpts()

  const db = await electrify(original, config, opts)

  t.is(typeof db.pragma, 'function')
})

test('the electrified database has `.electric.potentiallyChanged()`', async (t) => {
  const original = new MockDatabase('test.db')
  const opts = getNewOpts()
  const db = await electrify(original, config, opts)

  const { notifier } = opts

  t.is(notifier.notifications.length, 0)

  db.electric.potentiallyChanged()

  t.is(notifier.notifications.length, 1)
})

test("exec'ing a dangerous statement calls potentiallyChanged", async (t) => {
  const original = new MockDatabase('test.db')
  const opts = getNewOpts()
  const db = await electrify(original, config, opts)

  const { notifier } = opts

  t.is(notifier.notifications.length, 0)

  db.exec('insert into parent')

  t.is(notifier.notifications.length, 1)
})

test("exec'ing a non dangerous statement doesn't call potentiallyChanged", async (t) => {
  const original = new MockDatabase('test.db')
  const opts = getNewOpts()
  const db = await electrify(original, config, opts)

  const { notifier } = opts

  t.is(notifier.notifications.length, 0)

  db.exec('select 1')

  t.is(notifier.notifications.length, 0)
})

test('running a transaction function calls potentiallyChanged', async (t) => {
  const original = new MockDatabase('test.db')
  const opts = getNewOpts()
  const db = await electrify(original, config, opts)

  const { notifier } = opts

  t.is(notifier.notifications.length, 0)

  const runTx = db.transaction(() => {})
  runTx()

  t.is(notifier.notifications.length, 1)
})

test('running a transaction sub function calls potentiallyChanged', async (t) => {
  const original = new MockDatabase('test.db')
  const opts = getNewOpts()
  const db = await electrify(original, config, opts)

  const { notifier } = opts

  const a = db.transaction(() => {})
  const b = db.transaction(() => {})
  const c = db.transaction(() => {})

  t.is(notifier.notifications.length, 0)

  a.deferred()
  t.is(notifier.notifications.length, 1)

  b.immediate()
  t.is(notifier.notifications.length, 2)

  c.exclusive()
  t.is(notifier.notifications.length, 3)
})

test('electrify preserves chainability', async (t) => {
  const original = new MockDatabase('test.db')
  const opts = getNewOpts()
  const db = await electrify(original, config, opts)

  const { notifier } = opts

  t.is(notifier.notifications.length, 0)

  db.exec('insert into parent').exec('update parent').exec('drop parent')

  t.is(notifier.notifications.length, 3)
})

test('running a prepared statement outside of a transaction notifies', async (t) => {
  const original = new MockDatabase('test.db')
  const opts = getNewOpts()
  const db = await electrify(original, config, opts)

  const { notifier } = opts

  t.is(notifier.notifications.length, 0)

  const stmt = db.prepare('insert into parent')
  stmt.run()

  t.is(notifier.notifications.length, 1)
})

test('running a prepared statement *inside* of a transaction does *not* notify', async (t) => {
  const original = new MockDatabase('test.db')
  const opts = getNewOpts()
  const db = await electrify(original, config, opts)

  const { notifier } = opts

  t.is(notifier.notifications.length, 0)

  const stmt = db.prepare('insert into parent')
  const runTx = db.transaction(() => {
    stmt.run()
  })
  runTx()

  // The transaction notifies, so we're testing it's only
  // one notification not two!
  t.is(notifier.notifications.length, 1)
})

test('iterating a prepared statement works', async (t) => {
  const original = new MockDatabase(dbFilename)
  const opts = getNewOpts()
  const db = await electrify(original, config, opts)

  const { notifier } = opts

  t.is(notifier.notifications.length, 0)

  const stmt = db.prepare('insert into parent')
  Array.from(stmt.iterate())

  t.is(opts.notifier.notifications.length, 1)
})

test('database adapter run works', async (t) => {
  const db = new MockDatabase('test.db')
  const adapter = new DatabaseAdapter(db)

  const sql = 'drop table badgers'
  const result = await adapter.run({ sql })

  t.is(result.rowsAffected, 0) // rowsAffected only counts rows affected by insert, update, and delete statements
})

test('database adapter query works', async (t) => {
  const db = new MockDatabase('test.db')
  const adapter = new DatabaseAdapter(db)

  const sql = 'select foo from bars'
  const result = await adapter.query({ sql })

  t.deepEqual(result, [{ foo: 'bar' }, { foo: 'baz' }])
})

test('database adapter tableNames works', async (t) => {
  const db = new MockDatabase('test.db')
  const adapter = new DatabaseAdapter(db)

  const sql = 'select foo from bar'
  const r1 = adapter.tableNames({ sql })

  t.deepEqual(r1, [new QualifiedTablename('main', 'bar')])
})

// Test with an actual better-sqlite3 DB
async function makeAdapter() {
  const db = new Database(':memory:')
  const adapter = new DatabaseAdapter(db)
  const createTableSql =
    "CREATE TABLE IF NOT EXISTS Post('id' varchar PRIMARY KEY, 'title' varchar, 'contents' varchar, 'nbr' int);"
  await adapter.run({ sql: createTableSql })
  return adapter
}

test('adapter run works on real DB', async (t) => {
  const adapter = await makeAdapter()
  const insertRecordSql =
    "INSERT INTO Post (id, title, contents, nbr) VALUES ('i1', 't1', 'c1', 18)"
  const res = await adapter.run({ sql: insertRecordSql })
  t.is(res.rowsAffected, 1)
})

test('adapter query works on real DB', async (t) => {
  const adapter = await makeAdapter()
  const insertRecordSql =
    "INSERT INTO Post (id, title, contents, nbr) VALUES ('i1', 't1', 'c1', 18)"
  await adapter.run({ sql: insertRecordSql })

  const selectSql =
    "SELECT * FROM Post WHERE (id = ('i1')) AND (nbr = (18)) LIMIT 1"
  const res = await adapter.query({ sql: selectSql })
  t.deepEqual(res, [{ id: 'i1', title: 't1', contents: 'c1', nbr: 18 }])
})

test('adapter runInTransaction works on real DB', async (t) => {
  const adapter = await makeAdapter()
  const insertRecord1Sql =
    "INSERT INTO Post (id, title, contents, nbr) VALUES ('i1', 't1', 'c1', 18)"
  const insertRecord2Sql =
    "INSERT INTO Post (id, title, contents, nbr) VALUES ('i2', 't2', 'c2', 25)"

  const txRes = await adapter.runInTransaction(
    { sql: insertRecord1Sql },
    { sql: insertRecord2Sql }
  )

  t.is(txRes.rowsAffected, 2)

  const selectAll = 'SELECT id FROM Post'
  const res = await adapter.query({ sql: selectAll })

  t.deepEqual(res, [{ id: 'i1' }, { id: 'i2' }])
})

test('adapter runInTransaction rolls back on conflict', async (t) => {
  const adapter = await makeAdapter()
  const insertRecord1Sql =
    "INSERT INTO Post (id, title, contents, nbr) VALUES ('i1', 't1', 'c1', 18)"
  const insertRecord2Sql =
    "INSERT INTO Post (id, title, contents, nbr) VALUES ('i1', 't2', 'c2', 25)"

  try {
    await adapter.runInTransaction(
      { sql: insertRecord1Sql },
      { sql: insertRecord2Sql }
    )
    t.fail() // the transaction should be rejected because the primary key of the second record already exists
  } catch (err) {
    const castError = err as { code: string }
    t.is(castError.code, 'SQLITE_CONSTRAINT_PRIMARYKEY')

    // Check that no posts were added to the DB
    const selectAll = 'SELECT id FROM Post'
    const res = await adapter.query({ sql: selectAll })
    t.deepEqual(res, [])
  }
})

test('adapter supports dependent queries in transaction on real DB', async (t) => {
  const adapter = await makeAdapter()
  const [txRes, rowsAffected] = (await adapter.transaction<Array<number>>(
    (tx, setResult) => {
      let rowsAffected = 0
      tx.run(
        {
          sql: "INSERT INTO Post (id, title, contents, nbr) VALUES ('i1', 't1', 'c1', 18)",
        },
        (tx2, res) => {
          rowsAffected += res.rowsAffected
          const select = { sql: "SELECT nbr FROM Post WHERE id = 'i1'" }
          tx2.query(select, (tx3, rows) => {
            const [res] = rows as unknown as Array<{ nbr: number }>
            const newNbr = res.nbr + 2
            tx3.run(
              {
                sql: `INSERT INTO Post (id, title, contents, nbr) VALUES ('i2', 't2', 'c2', ${newNbr})`,
              },
              (_, res) => {
                rowsAffected += res.rowsAffected
                setResult([newNbr, rowsAffected])
              }
            )
          })
        }
      )
    }
  )) as unknown as Array<number>

  t.is(txRes, 20)
  t.is(rowsAffected, 2)

  const selectAll = 'SELECT * FROM Post'
  const res = await adapter.query({ sql: selectAll })

  t.deepEqual(res, [
    { id: 'i1', title: 't1', contents: 'c1', nbr: 18 },
    { id: 'i2', title: 't2', contents: 'c2', nbr: 20 },
  ])
})

test('adapter rolls back dependent queries on conflict', async (t) => {
  const adapter = await makeAdapter()
  try {
    await adapter.transaction((tx) => {
      tx.run({
        sql: "INSERT INTO Post (id, title, contents, nbr) VALUES ('i1', 't1', 'c1', 18)",
      })
      tx.run({
        sql: "INSERT INTO Post (id, title, contents, nbr) VALUES ('i1', 't2', 'c2', 20)",
      })
    })
    t.fail() // the transaction should be rejected because the primary key of the second record already exists
  } catch (err) {
    const castError = err as { code: string }
    t.is(castError.code, 'SQLITE_CONSTRAINT_PRIMARYKEY')

    // Check that no posts were added to the DB
    const selectAll = 'SELECT id FROM Post'
    const res = await adapter.query({ sql: selectAll })
    t.deepEqual(res, [])
  }
})
