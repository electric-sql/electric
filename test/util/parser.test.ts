import test from 'ava'

import { isPotentiallyDangerous, parseSqlIntoStatements, parseTableNames } from '../../src/util/parser'
import { QualifiedTablename } from '../../src/util/tablename'

import { data as migrationData } from '../support/migrations/index'

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

test('parse migration body into statements', t => {
  const { migrations } = migrationData
  const { body } = migrations[0]

  const stmts = parseSqlIntoStatements(body)

  t.deepEqual(stmts, [
    'CREATE TABLE IF NOT EXISTS _electric_oplog (\n' +
      '  rowid INTEGER PRIMARY KEY AUTOINCREMENT,\n' +
      '  namespace String NOT NULL,\n' +
      '  tablename String NOT NULL,\n' +
      '  optype String NOT NULL,\n' +
      '  primaryKey String NOT NULL,\n' +
      '  newRow String,\n' +
      '  oldRow String,\n' +
      '  timestamp TEXT\n' +
      ');',
    'CREATE TABLE IF NOT EXISTS _electric_meta (\n  key TEXT,\n  value TEXT\n);',
    'CREATE TABLE IF NOT EXISTS _electric_migrations (\n' +
      '  id INTEGER PRIMARY KEY AUTOINCREMENT,\n' +
      '  name TEXT NOT NULL UNIQUE,\n' +
      '  sha256 TEXT NOT NULL,\n' +
      '  applied_at TEXT NOT NULL\n' +
      ');',
    "INSERT INTO _electric_meta (key, value) VALUES ('compensations', 0), ('lastAckdRowId','0'), ('lastSentRowId', '0'), ('lsn', '0');",
    'DROP TABLE IF EXISTS _electric_trigger_settings;',
    'CREATE TABLE _electric_trigger_settings(tablename STRING PRIMARY KEY, flag INTEGER);'
  ])

  migrations.forEach(({ body }) => {
    const normalised = body.replaceAll('STRICT, ', '').replaceAll('STRICT', '')

    try {
      const stmts = parseSqlIntoStatements(normalised)
    }
    catch (err) {
      console.log(normalised)
      console.warn(err)
    }

    t.true(stmts.length > 1)
  })
})
