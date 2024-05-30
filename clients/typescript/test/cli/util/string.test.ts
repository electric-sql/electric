import test from 'ava'
import { buildDatabaseURL, dedent } from '../../../src/cli/util'

test('buildDatabaseURL should compose valid URL', (t) => {
  const url = buildDatabaseURL({
    user: 'admin',
    password: 'adminpass',
    host: '192.168.1.1',
    port: 3306,
    dbName: 'mydatabase',
  })

  t.is(url, 'postgresql://admin:adminpass@192.168.1.1:3306/mydatabase')
})

test('buildDatabaseURL without password', (t) => {
  const url = buildDatabaseURL({
    user: 'user',
    password: '',
    host: 'example.com',
    port: 5432,
    dbName: 'sampledb',
  })

  t.is(url, 'postgresql://user@example.com:5432/sampledb')
})

test('buildDatabaseURL with complex password', (t) => {
  const url = buildDatabaseURL({
    user: 'user',
    password: 'p@$$w0rd!',
    host: 'example.com',
    port: 5432,
    dbName: 'sampledb',
  })

  t.is(url, 'postgresql://user:p%40$$w0rd!@example.com:5432/sampledb')
})

test('buildDatabaseURL without SSL', (t) => {
  const url = buildDatabaseURL({
    user: 'testuser',
    password: 'testpass',
    host: 'localhost',
    port: 5432,
    dbName: 'testdb',
  })

  t.is(url, 'postgresql://testuser:testpass@localhost:5432/testdb')
})

test('buildDatabaseURL with SSL required', (t) => {
  const url = buildDatabaseURL({
    user: 'testuser',
    password: 'testpass',
    host: 'localhost',
    port: 5432,
    dbName: 'testdb',
    ssl: true,
  })

  t.is(
    url,
    'postgresql://testuser:testpass@localhost:5432/testdb?sslmode=require'
  )
})

test('buildDatabaseURL with SSL disabled', (t) => {
  const url = buildDatabaseURL({
    user: 'testuser',
    password: 'testpass',
    host: 'localhost',
    port: 5432,
    dbName: 'testdb',
    ssl: false,
  })

  t.is(
    url,
    'postgresql://testuser:testpass@localhost:5432/testdb?sslmode=disable'
  )
})

test('dedent removes indentation and newlines from multiline strings', (t) => {
  const result = dedent`
    This is a
    multiline
    string
  `
  t.is(result, 'This is a multiline string')
})
