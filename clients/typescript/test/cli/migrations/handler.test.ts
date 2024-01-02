import test from 'ava'
import { parseGenerateArgs } from '../../../src/cli/migrations/handler'

test('generate accepts url to Electric endpoint', (t) => {
  const url = 'http://localhost:5133'
  const opts = parseGenerateArgs(['--service', url])
  t.deepEqual(opts, {
    service: url,
  })
})

test('generate accepts url without http prefix to Electric endpoint', (t) => {
  const url = 'localhost:5133'
  const opts = parseGenerateArgs(['--service', url])
  t.deepEqual(opts, {
    service: 'http://' + url,
  })
})

test('generate accepts output path', (t) => {
  const path = './src'
  const opts = parseGenerateArgs(['--out', path])
  t.deepEqual(opts, {
    out: path,
  })
})

test('generate accepts watch flag without polling interval', (t) => {
  const opts = parseGenerateArgs(['--watch'])
  t.deepEqual(opts, {
    watch: true,
  })
})

test('generate accepts watch flag with polling interval', (t) => {
  const opts = parseGenerateArgs(['--watch', '2000'])
  t.deepEqual(opts, {
    watch: true,
    pollingInterval: 2000,
  })
})

test('generate accepts debug flag', (t) => {
  const opts = parseGenerateArgs(['--debug'])
  t.deepEqual(opts, {
    debug: true,
  })
})

test('generate accepts several flags', (t) => {
  const url = 'http://localhost:5133'
  const path = './src'
  const opts = parseGenerateArgs(['--service', url, '--out', path])

  t.deepEqual(opts, {
    service: url,
    out: path,
  })
})
