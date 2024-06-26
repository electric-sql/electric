import test from 'ava'

import Database from 'better-sqlite3'

import { DatabaseAdapter } from '../src/better-sqlite3/adapter.js'
import { MockDatabase } from '../src/better-sqlite3/mock.js'
import { QualifiedTablename } from '../src/util/tablename.js'
import { UncoordinatedDatabaseAdapter } from '../src/adapter.js'

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

test('adapter isolates grouped queries from other queries/transactions', async (t) => {
  const adapter = await makeAdapter()

  let query1Finished = false

  // Make a slow grouped query and check that it is not interleaved with other queries/transactions
  const slowQuery = async (adapter: UncoordinatedDatabaseAdapter) => {
    await new Promise((resolve) => setTimeout(resolve, 100))
    await adapter.query({ sql: 'SELECT 1' })
    query1Finished = true
    return 7
  }

  const prom1 = adapter.runExclusively(slowQuery)
  const prom2 = adapter.transaction(async (_tx, setResult) => {
    t.true(query1Finished)
    setResult(5)
  })

  const results = await Promise.all([prom1, prom2])
  t.deepEqual(results, [7, 5])
})
