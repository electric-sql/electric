import test from 'ava'

import { ElectricDatabase } from '../../src/drivers/node-postgres'
import { MockDatabase } from '../../src/drivers/node-postgres/mock'
import { DatabaseAdapter } from '../../src/drivers/node-postgres'
import fs from 'fs/promises'

test('database adapter run works', async (t) => {
  const db = new MockDatabase('test.db')
  const adapter = new DatabaseAdapter(db)

  const sql = 'drop table badgers'
  const result = await adapter.run({ sql })

  t.is(result.rowsAffected, 0)
})

test('database adapter query works', async (t) => {
  const db = new MockDatabase('test.db')
  const adapter = new DatabaseAdapter(db)

  const sql = 'select * from bars'
  const result = await adapter.query({ sql })

  t.deepEqual(result, [
    {
      val: 1,
    },
    {
      val: 2,
    },
  ])
})

// Test with an actual embedded-postgres DB
async function makeAdapter() {
  const db = await ElectricDatabase.init({
    name: 'driver-test',
    databaseDir: './tmp/pg/db',
    persistent: false,
  })

  const adapter = new DatabaseAdapter(db)
  const createTableSql =
    'CREATE TABLE IF NOT EXISTS Post(id TEXT PRIMARY KEY, title TEXT, contents TEXT, nbr integer);'
  await adapter.run({ sql: createTableSql })
  const stop = async () => {
    await db.stop()
    await fs.rm('./tmp', { recursive: true, force: true })
  }
  return { adapter, stop }
}

test.serial('adapter run works on real DB', async (t) => {
  const { adapter, stop } = await makeAdapter()
  const insertRecordSql =
    "INSERT INTO Post (id, title, contents, nbr) VALUES ('i1', 't1', 'c1', 18)"
  const res = await adapter.run({ sql: insertRecordSql })
  t.is(res.rowsAffected, 1)
  await stop()
})

test.serial('adapter query works on real DB', async (t) => {
  const { adapter, stop } = await makeAdapter()
  const insertRecordSql =
    "INSERT INTO Post (id, title, contents, nbr) VALUES ('i1', 't1', 'c1', 18)"
  await adapter.run({ sql: insertRecordSql })

  const selectSql =
    "SELECT * FROM Post WHERE (id = ('i1')) AND (nbr = (18)) LIMIT 1"
  const res = await adapter.query({ sql: selectSql })
  t.deepEqual(res, [{ id: 'i1', title: 't1', contents: 'c1', nbr: 18 }])
  await stop()
})

test.serial('adapter runInTransaction works on real DB', async (t) => {
  const { adapter, stop } = await makeAdapter()
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
  await stop()
})

test.serial('adapter runInTransaction rolls back on conflict', async (t) => {
  const { adapter, stop } = await makeAdapter()
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
    const castError = err as { code: string; detail: string }
    t.is(castError.code, '23505')
    t.is(castError.detail, 'Key (id)=(i1) already exists.')

    // Check that no posts were added to the DB
    const selectAll = 'SELECT id FROM Post'
    const res = await adapter.query({ sql: selectAll })
    t.deepEqual(res, [])
  }
  await stop()
})

test.serial(
  'adapter supports dependent queries in transaction on real DB',
  async (t) => {
    const { adapter, stop } = await makeAdapter()
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
    await stop()
  }
)

test.serial('adapter rolls back dependent queries on conflict', async (t) => {
  const { adapter, stop } = await makeAdapter()
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
    const castError = err as { code: string; detail: string }
    t.is(castError.code, '23505')
    t.is(castError.detail, 'Key (id)=(i1) already exists.')

    // Check that no posts were added to the DB
    const selectAll = 'SELECT id FROM Post'
    const res = await adapter.query({ sql: selectAll })
    t.deepEqual(res, [])
  }
  await stop()
})
