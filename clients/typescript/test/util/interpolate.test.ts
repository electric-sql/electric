import test from 'ava'
import { interpolateSqlArgs } from '../../src/util'

test('interpolateSqlArgs no arguments provided', (t) => {
  const sql = 'SELECT * FROM users'
  const result = interpolateSqlArgs({ sql })
  t.is(result, sql)
})

test('interpolateSqlArgs no placeholders in SQL', (t) => {
  const sql = 'SELECT * FROM users WHERE id = 1'
  const args: string[] = ['test']
  const result = interpolateSqlArgs({ sql, args })
  t.is(result, sql)
})

test('interpolateSqlArgs one placeholder with one argument', (t) => {
  const sql = 'SELECT * FROM users WHERE id = ?'
  const args: string[] = ['1']
  const expected = 'SELECT * FROM users WHERE id = 1'
  const result = interpolateSqlArgs({ sql, args })
  t.is(result, expected)
})

test('interpolateSqlArgs multiple placeholders with corresponding arguments', (t) => {
  const sql = 'SELECT * FROM users WHERE id = ? AND name = ?'
  const args: string[] = ['1', 'John']
  const expected = 'SELECT * FROM users WHERE id = 1 AND name = John'
  const result = interpolateSqlArgs({ sql, args })
  t.is(result, expected)
})

test('interpolateSqlArgs placeholders preceded by word character', (t) => {
  const sql = "SELECT * FROM users WHERE id = ? AND name = 'what?'"
  const args: string[] = ['1', 'John']
  const expected = "SELECT * FROM users WHERE id = 1 AND name = 'what?'"
  const result = interpolateSqlArgs({ sql, args })
  t.is(result, expected)
})

test('interpolateSqlArgs more placeholders than arguments', (t) => {
  const sql = 'SELECT * FROM users WHERE id = ? AND name = ?'
  const args: string[] = ['1']
  const expected = 'SELECT * FROM users WHERE id = 1 AND name = ?'
  const result = interpolateSqlArgs({ sql, args })
  t.is(result, expected)
})

test('interpolateSqlArgs special characters and edge cases', (t) => {
  const sql = 'SELECT * FROM users WHERE id = ? OR email LIKE ?'
  const args: string[] = ['1', '%@example.com']
  const expected =
    'SELECT * FROM users WHERE id = 1 OR email LIKE %@example.com'
  const result = interpolateSqlArgs({ sql, args })
  t.is(result, expected)
})

test('interpolateSqlArgs placeholder at the beginning', (t) => {
  const sql = '? = 1'
  const args: string[] = ['id']
  const expected = 'id = 1'
  const result = interpolateSqlArgs({ sql, args })
  t.is(result, expected)
})

test('interpolateSqlArgs placeholder at the end', (t) => {
  const sql = 'id = ?'
  const args: string[] = ['1']
  const expected = 'id = 1'
  const result = interpolateSqlArgs({ sql, args })
  t.is(result, expected)
})

test('interpolateSqlArgs consecutive placeholders', (t) => {
  const sql = '?, ?'
  const args: string[] = ['1', '2']
  const expected = '1, 2'
  const result = interpolateSqlArgs({ sql, args })
  t.is(result, expected)
})
