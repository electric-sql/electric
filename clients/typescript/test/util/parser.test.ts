import test from 'ava'

import { isPotentiallyDangerous, parseTableNames } from '../../src/util/parser'
import { QualifiedTablename } from '../../src/util/tablename'
import parserCases from './parser.test.fixtures.json'

test('selects are not dangerous', (t) => {
  const stmt = 'select foo from bar'

  t.false(isPotentiallyDangerous(stmt))
})

test('inserts are dangerous', (t) => {
  const stmt = 'insert foo into bar'

  t.true(isPotentiallyDangerous(stmt))
})

test('parse tablenames from simple query', (t) => {
  const query = 'select * from laundry;'
  const results = parseTableNames(query, 'main')

  t.deepEqual(results, [new QualifiedTablename('main', 'laundry')])
})

test('parse namespaced query', (t) => {
  const query = 'select * from public.laundry;'
  const results = parseTableNames(query, 'main')

  t.deepEqual(results, [new QualifiedTablename('public', 'laundry')])
})

test('parse a query with join', (t) => {
  const query = `
    select * from a
      join b on b.id = a.b_id
      where b.foo = 1;
  `
  const results = parseTableNames(query, 'main')

  t.deepEqual(results, [
    new QualifiedTablename('main', 'a'),
    new QualifiedTablename('main', 'b'),
  ])
})

test('parse tablenames from nested query', (t) => {
  const query = `
    SELECT
      users.id,
      users.username,
      orders.order_number,
      products.product_name
    FROM
      users
      JOIN orders ON users.id = orders.user_id
      JOIN (
        SELECT
          user_id,
          product_name
        FROM
          order_details
          JOIN products ON order_details.product_id = products.id
        WHERE
          order_details.quantity > 5
      ) AS nested_table ON users.id = nested_table.user_id
    WHERE
      users.status = 'active';
  `
  const results = parseTableNames(query, 'main')

  t.deepEqual(results, [
    new QualifiedTablename('main', 'order_details'),
    new QualifiedTablename('main', 'orders'),
    new QualifiedTablename('main', 'products'),
    new QualifiedTablename('main', 'users'),
  ])
})

for (let i = 0; i < parserCases.testCases.length; i++) {
  const testCase = parserCases.testCases[i]
  test(`parse tablenames from query ${
    testCase.name ?? testCase.query
  }`, (t) => {
    const results = parseTableNames(testCase.query, 'main')
    const expectedResults = testCase.expectedResults.map(
      (r) => new QualifiedTablename(r.namespace ?? 'main', r.tablename)
    )
    t.deepEqual(results, expectedResults)
  })
}

test('parse tablenames from windowed query (SQLite version >3.25)', (t) => {
  const query = `
    SELECT timestamp, value, 
    avg(value) OVER (ORDER BY timestamp ROWS BETWEEN 3 PRECEDING AND 3 FOLLOWING) as moving_average
    FROM monitoring ORDER BY timestamp
  `
  const results = parseTableNames(query, 'main')
  t.deepEqual(results, [new QualifiedTablename('main', 'monitoring')])
})
