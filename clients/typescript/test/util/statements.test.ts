import test from 'ava'

import { prepareInsertBatchedStatements } from '../../src/util/statements'

test('prepareInsertBatchedStatements correctly splits up data in batches', (t) => {
  const data = [
    { a: 1, b: 2 },
    { a: 3, b: 4 },
    { a: 5, b: 6 },
  ]
  const stmts = prepareInsertBatchedStatements(
    'INSERT INTO test (a, b) VALUES',
    ['a', 'b'],
    data,
    5 // at most 5 `?`s in one SQL statement, so we should see the split
  )

  t.deepEqual(stmts, [
    {
      sql: 'INSERT INTO test (a, b) VALUES (?, ?), (?, ?)',
      args: [1, 2, 3, 4],
    },
    { sql: 'INSERT INTO test (a, b) VALUES (?, ?)', args: [5, 6] },
  ])
})

test('prepareInsertBatchedStatements respects column order', (t) => {
  const data = [
    { a: 1, b: 2 },
    { a: 3, b: 4 },
    { a: 5, b: 6 },
  ]
  const stmts = prepareInsertBatchedStatements(
    'INSERT INTO test (a, b) VALUES',
    ['b', 'a'],
    data,
    5
  )

  t.deepEqual(stmts, [
    {
      sql: 'INSERT INTO test (a, b) VALUES (?, ?), (?, ?)',
      args: [2, 1, 4, 3],
    },
    { sql: 'INSERT INTO test (a, b) VALUES (?, ?)', args: [6, 5] },
  ])
})
