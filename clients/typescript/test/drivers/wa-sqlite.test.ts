import test from 'ava'

import { MockDatabase } from '../../src/drivers/wa-sqlite/mock'
import { DatabaseAdapter } from '../../src/drivers/wa-sqlite'
import { QualifiedTablename } from '../../src/util'

test('database adapter run works', async (t) => {
  const db = new MockDatabase('test.db')
  const adapter = new DatabaseAdapter(db)

  const sql = 'drop table badgers'
  const result = await adapter.run({ sql })

  t.is(result.rowsAffected, 0)
})

test('database adapter query works', async (t) => {
  const dbName = 'test.db'
  const db = new MockDatabase(dbName)
  const adapter = new DatabaseAdapter(db)

  const sql = 'select * from bars'
  const result = await adapter.query({ sql })

  t.deepEqual(result, [
    {
      db: dbName,
      val: 1,
    },
    {
      db: dbName,
      val: 2,
    },
  ])
})

test('database adapter runInTransaction works', async (t) => {
  const db = new MockDatabase('test.db')
  const adapter = new DatabaseAdapter(db)

  const sql = 'select * from bars'
  const res = await adapter.runInTransaction({ sql }, { sql }, { sql })

  t.assert(res.rowsAffected == 0)
})

test('database adapter interactive transaction works', async (t) => {
  const dbName = 'test.db'
  const db = new MockDatabase('test.db')
  const adapter = new DatabaseAdapter(db)

  const sql = 'select * from bars'
  const res = await adapter.transaction<number>((tx, setResult) => {
    tx.run({ sql }, (tx, res) => {
      t.assert(res.rowsAffected == 0)
      tx.query({ sql }, (_tx, res) => {
        t.deepEqual(res, [
          {
            db: dbName,
            val: 1,
          },
          {
            db: dbName,
            val: 2,
          },
        ])

        setResult(5)
      })
    })
  })

  t.assert(res == 5)
})

test('database adapter rejects promise on failure', async (t) => {
  const err = new Error('Test failure')
  const db = new MockDatabase('test.db', err)
  const adapter = new DatabaseAdapter(db)

  const sql = 'select * from bars'

  const assertFailure = async (prom: Promise<any>) => {
    await t.throwsAsync(prom, { instanceOf: Error, message: err.message })
  }

  await assertFailure(adapter.run({ sql }))
  await assertFailure(adapter.query({ sql }))
  await assertFailure(adapter.runInTransaction({ sql }, { sql }))
  await assertFailure(
    adapter.transaction((tx, setResult) => {
      tx.run({ sql }, () => {
        setResult(5)
      })
    })
  )
})

test('database adapter interactive transaction rejects promise on failure', async (t) => {
  const db = new MockDatabase('test.db')
  const adapter = new DatabaseAdapter(db)

  await t.throwsAsync(
    adapter.transaction((_tx, _setResult) => {
      throw Error('Oops')
    }),
    { instanceOf: Error, message: 'Oops' }
  )
})

test('database adapter tableNames works', async (t) => {
  const db = new MockDatabase('test.db')
  const adapter = new DatabaseAdapter(db)

  const sql = 'select db from bar'
  const r1 = adapter.tableNames({ sql })

  t.deepEqual(r1, [new QualifiedTablename('main', 'bar')])
})
