import test from 'ava'

import { isPotentiallyDangerous, parseTableNames } from '../../src/util/parser'
import { QualifiedTablename } from '../../src/util/tablename'

test('selects are not dangerous', t => {
  const stmt = 'select foo from bar'

  t.false(isPotentiallyDangerous(stmt))
})

test('inserts are dangerous', t => {
  const stmt = 'insert foo into bar'

  t.true(isPotentiallyDangerous(stmt))
})

test('parse tablenames from simple query', t => {
  const query = 'select * from laundry;'
  const results = parseTableNames(query, 'main')

  t.deepEqual(results, [new QualifiedTablename('main', 'laundry')])
})

test('parse namespaced query', t => {
  const query = 'select * from public.laundry;'
  const results = parseTableNames(query, 'main')

  t.deepEqual(results, [new QualifiedTablename('public', 'laundry')])
})

test('parse a query with join', t => {
  const query = `
    select * from a
      join b on b.id = a.b_id
      where b.foo = 1;
  `
  const results = parseTableNames(query, 'main')

  t.deepEqual(results, [
    new QualifiedTablename('main', 'a'),
    new QualifiedTablename('main', 'b')
  ])
})