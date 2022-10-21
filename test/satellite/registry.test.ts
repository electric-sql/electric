import test from 'ava'

import { DatabaseAdapter } from '../../src/electric/adapter'
import { Migrator } from '../../src/migrators/index'
import { Notifier } from '../../src/notifiers/index'
import { MockSatelliteProcess, MockRegistry } from '../../src/satellite/mock'
import { Socket } from '../../src/sockets'

const dbName = 'test.db'
const adapter = {} as DatabaseAdapter
const migrator = {} as Migrator
const notifier = {} as Notifier
const socket = {} as Socket
const opts = { config: {app: "app", replication: {address: "", port: 0}}}
const args = [dbName, adapter, migrator, notifier, socket, opts] as const

test('starting a satellite process works', async t => {
  const mockRegistry = new MockRegistry()
  const satellite = await mockRegistry.startProcess(...args)

  t.true(satellite instanceof MockSatelliteProcess)
})

test('starting multiple satellite processes works', async t => {
  const mockRegistry = new MockRegistry()
  const s1 = await mockRegistry.startProcess('a.db', adapter, migrator, notifier, socket)
  const s2 = await mockRegistry.startProcess('b.db', adapter, migrator, notifier, socket)
  const s3 = await mockRegistry.startProcess('c.db', adapter, migrator, notifier, socket)

  t.true(s1 instanceof MockSatelliteProcess)
  t.true(s2 instanceof MockSatelliteProcess)
  t.true(s3 instanceof MockSatelliteProcess)
})

test('ensure satellite process started works', async t => {
  const mockRegistry = new MockRegistry()
  const satellite = await mockRegistry.ensureStarted(...args)

  t.true(satellite instanceof MockSatelliteProcess)
})

test('ensure starting multiple satellite processes works', async t => {
  const mockRegistry = new MockRegistry()
  const s1 = await mockRegistry.ensureStarted('a.db', adapter, migrator, notifier, socket, opts)
  const s2 = await mockRegistry.ensureStarted('b.db', adapter, migrator, notifier, socket, opts)
  const s3 = await mockRegistry.ensureStarted('c.db', adapter, migrator, notifier, socket, opts)

  t.true(s1 instanceof MockSatelliteProcess)
  t.true(s2 instanceof MockSatelliteProcess)
  t.true(s3 instanceof MockSatelliteProcess)
})

test('concurrent calls to ensureStarted with same dbName get same process', async t => {
  const mockRegistry = new MockRegistry()
  const [s1, s2, s3] = await Promise.all([
    mockRegistry.ensureStarted(...args),
    mockRegistry.ensureStarted(...args),
    mockRegistry.ensureStarted(...args)
  ])

  t.is(s1, s2)
  t.is(s2, s3)
})

test('ensureAlreadyStarted fails if not already started', async t => {
  const mockRegistry = new MockRegistry()
  await t.throwsAsync(mockRegistry.ensureAlreadyStarted(dbName), {
    message: `Satellite not running for db: ${dbName}`
  })
})

test('ensureAlreadyStarted succeeds if fully started', async t => {
  const mockRegistry = new MockRegistry()
  await mockRegistry.ensureStarted(...args)
  const satellite = await mockRegistry.ensureAlreadyStarted(dbName)

  t.true(satellite instanceof MockSatelliteProcess)
})

test('ensureAlreadyStarted succeeds if in the process of starting', async t => {
  const mockRegistry = new MockRegistry()
  const promise = mockRegistry.ensureStarted(...args)
  const satellite = await mockRegistry.ensureAlreadyStarted(dbName)

  t.true(satellite instanceof MockSatelliteProcess)
  t.is(satellite, await promise)
})

test('stop defaults to a noop', async t => {
  const mockRegistry = new MockRegistry()
  const result = await mockRegistry.stop(dbName)

  t.is(result, undefined)
})

test('stop works if running', async t => {
  const mockRegistry = new MockRegistry()
  const satellite = await mockRegistry.ensureStarted(...args)
  t.is(mockRegistry.satellites[dbName], satellite)

  await mockRegistry.stop(dbName)
  t.is(mockRegistry.satellites[dbName], undefined as any)
})

test('stop works if starting', async t => {
  const mockRegistry = new MockRegistry()
  const promise = mockRegistry.ensureStarted(...args)
  await mockRegistry.stop(dbName)

  t.is(mockRegistry.satellites[dbName], undefined as any)

  await promise
  t.is(mockRegistry.satellites[dbName], undefined as any)
})

test('stopAll works', async t => {
  const mockRegistry = new MockRegistry()
  const [s1, s2, s3] = await Promise.all([
    mockRegistry.ensureStarted('a.db', adapter, migrator, notifier, socket, opts),
    mockRegistry.ensureStarted('b.db', adapter, migrator, notifier, socket, opts),
    mockRegistry.ensureStarted('c.db', adapter, migrator, notifier, socket, opts)
  ])
  await mockRegistry.stopAll()

  t.deepEqual(mockRegistry.satellites, {})
})

test('stopAll works even when starting', async t => {
  const mockRegistry = new MockRegistry()
  const startPromises = [
    mockRegistry.ensureStarted('a.db', adapter, migrator, notifier, socket, opts),
    mockRegistry.ensureStarted('b.db', adapter, migrator, notifier, socket, opts),
    mockRegistry.ensureStarted('c.db', adapter, migrator, notifier, socket, opts)
  ]

  await mockRegistry.stopAll()
  t.deepEqual(mockRegistry.satellites, {})

  await Promise.all(startPromises)
  t.deepEqual(mockRegistry.satellites, {})
})

test('stopAll works across running, stopping and starting', async t => {
  const mockRegistry = new MockRegistry()
  await mockRegistry.ensureStarted('a.db', adapter, migrator, notifier, socket, opts)
  await mockRegistry.ensureStarted('b.db', adapter, migrator, notifier, socket, opts)
  const p1 = mockRegistry.ensureStarted('c.db', adapter, migrator, notifier, socket, opts)
  const p2 = mockRegistry.ensureStarted('d.db', adapter, migrator, notifier, socket, opts)

  const p3 = mockRegistry.stop('a.db')
  const p4 = mockRegistry.stop('c.db')

  await mockRegistry.stopAll()
  t.deepEqual(mockRegistry.satellites, {})

  await Promise.all([p1, p2, p3, p4])
  t.deepEqual(mockRegistry.satellites, {})
})
