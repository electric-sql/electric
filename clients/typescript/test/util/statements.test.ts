import test from 'ava'
import { dedent } from 'ts-dedent'

import { prepareInsertJsonBatchedStatement } from '../../src/util/statements'

test('prepareInsertJsonBatchedStatement respects column order', (t) => {
  const data = [
    { a: 1, b: 2 },
    { a: 3, b: 4 },
    { a: 5, b: 6 },
  ]
  const stmt = prepareInsertJsonBatchedStatement('test', ['b', 'a'], data)

  t.deepEqual(stmt, {
    sql: dedent`INSERT INTO test (b, a)
      SELECT json_extract(json_each.value, '$.b'), json_extract(json_each.value, '$.a')
      FROM json_each(?);`,
    args: ['[{"a":1,"b":2},{"a":3,"b":4},{"a":5,"b":6}]'],
  })
})
