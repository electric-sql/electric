import test from 'ava'

import { MockDatabaseAdapter } from '../../src/drivers/generic/mock'

test('runInTransaction works', async (t) => {
  const adapter = new MockDatabaseAdapter()

  const sql = 'INSERT INTO items VALUES (1);'
  const insert = { sql }

  t.plan(5)

  adapter.mockRun(async (stmt) => {
    // First statement is `BEGIN`
    t.deepEqual(stmt, { sql: 'BEGIN' })
    // Next statement should be our insert
    adapter.mockRun(async (stmt) => {
      t.deepEqual(stmt, insert)
      // Next statement should be `COMMIT`
      adapter.mockRun(async (stmt) => {
        t.deepEqual(stmt, { sql: 'COMMIT' })
        return { rowsAffected: 0 }
      })
      return { rowsAffected: 1 }
    })
    return { rowsAffected: 0 }
  })

  const result = await adapter.runInTransaction(insert)
  t.is(result.rowsAffected, 1)
  t.false(adapter.isLocked)
})

test('runInTransaction rolls back if commit fails', async (t) => {
  const adapter = new MockDatabaseAdapter()

  const sql = 'INSERT INTO items VALUES (1);'
  const insert = { sql }

  t.plan(6)

  adapter.mockRun(async (stmt) => {
    // First statement is `BEGIN`
    t.deepEqual(stmt, { sql: 'BEGIN' })
    // Next statement should be our insert
    adapter.mockRun(async (stmt) => {
      t.deepEqual(stmt, insert)
      // Next statement should be `COMMIT`
      adapter.mockRun(async (stmt) => {
        t.deepEqual(stmt, { sql: 'COMMIT' })
        // Next statement should be `ROLLBACK`
        // because we will mock a failure to commit
        adapter.mockRun(async (stmt) => {
          t.deepEqual(stmt, { sql: 'ROLLBACK' })
          return { rowsAffected: 0 }
        })
        // Now mock a failure to commit
        throw new Error('mocked commit failure')
      })
      return { rowsAffected: 1 }
    })
    return { rowsAffected: 0 }
  })

  await t.throwsAsync(adapter.runInTransaction(insert), {
    message: 'mocked commit failure',
  })

  t.false(adapter.isLocked)
})

test('interactive transactions work', async (t) => {
  const adapter = new MockDatabaseAdapter()

  const sql = 'INSERT INTO items VALUES (1);'
  const insert = { sql }

  t.plan(5)

  adapter.mockRun(async (stmt) => {
    // First statement is `BEGIN`
    t.deepEqual(stmt, { sql: 'BEGIN' })
    // Next statement should be our insert
    adapter.mockRun(async (stmt) => {
      t.deepEqual(stmt, insert)
      // Next statement should be `COMMIT`
      adapter.mockRun(async (stmt) => {
        t.deepEqual(stmt, { sql: 'COMMIT' })
        return { rowsAffected: 0 }
      })
      return { rowsAffected: 1 }
    })
    return { rowsAffected: 0 }
  })

  const result = await adapter.transaction(async (tx, setResult) => {
    await tx.run(insert)
    setResult(5)
  })
  t.is(result, 5)

  t.false(adapter.isLocked)
})

test('interactive transactions roll back if an error in between statements is thrown', async (t) => {
  const adapter = new MockDatabaseAdapter()

  const sql = 'INSERT INTO items VALUES (1);'
  const insert = { sql }

  t.plan(5)

  adapter.mockRun(async (stmt) => {
    // First statement is `BEGIN`
    t.deepEqual(stmt, { sql: 'BEGIN' })
    // Next statement should be our insert
    adapter.mockRun(async (stmt) => {
      t.deepEqual(stmt, insert)
      // Next statement should be `ROLLBACK`
      adapter.mockRun(async (stmt) => {
        t.deepEqual(stmt, { sql: 'ROLLBACK' })
        return { rowsAffected: 0 }
      })
      return { rowsAffected: 0 }
    })
    return { rowsAffected: 1 }
  })

  await t.throwsAsync(
    adapter.transaction((tx) => {
      tx.run(insert)
      throw new Error('mocked failure')
    }),
    {
      message: 'mocked failure',
    }
  )

  t.false(adapter.isLocked)
})

test('interactive transactions roll back once if an error in transaction is thrown', async (t) => {
  const adapter = new MockDatabaseAdapter()

  const sql = 'INSERT INTO items VALUES (1);'
  const insert = { sql }

  t.plan(5)

  adapter.mockRun(async (stmt) => {
    // First statement is `BEGIN`
    t.deepEqual(stmt, { sql: 'BEGIN' })
    // Next statement should be our insert
    adapter.mockRun(async (stmt) => {
      t.deepEqual(stmt, insert)

      // Next statement should be `ROLLBACK`, only once
      adapter.mockRun(async (stmt) => {
        t.deepEqual(stmt, { sql: 'ROLLBACK' })
        return { rowsAffected: 0 }
      })

      throw new Error('mocked failure')
    })
    return { rowsAffected: 1 }
  })

  await t.throwsAsync(
    adapter.transaction((tx, res) => {
      tx.run(insert, (_, r) => res(r))
    }),
    {
      message: 'mocked failure',
    }
  )

  t.false(adapter.isLocked)
})

test('interactive transactions roll back if commit fails', async (t) => {
  const adapter = new MockDatabaseAdapter()

  const sql = 'INSERT INTO items VALUES (1);'
  const insert = { sql }

  t.plan(6)

  adapter.mockRun(async (stmt) => {
    // First statement is `BEGIN`
    t.deepEqual(stmt, { sql: 'BEGIN' })
    // Next statement should be our insert
    adapter.mockRun(async (stmt) => {
      t.deepEqual(stmt, insert)
      // Next statement should be `COMMIT`
      adapter.mockRun(async (stmt) => {
        t.deepEqual(stmt, { sql: 'COMMIT' })
        // Next statement should be `ROLLBACK`
        // because we will mock a failure to commit
        adapter.mockRun(async (stmt) => {
          t.deepEqual(stmt, { sql: 'ROLLBACK' })
          return { rowsAffected: 0 }
        })
        // Now mock a failure to commit
        throw new Error('mocked commit failure')
      })
      return { rowsAffected: 1 }
    })
    return { rowsAffected: 0 }
  })

  await t.throwsAsync(
    adapter.transaction((tx, setResult) => {
      tx.run(insert)
      setResult(5)
    }),
    {
      message: 'mocked commit failure',
    }
  )

  t.false(adapter.isLocked)
})
