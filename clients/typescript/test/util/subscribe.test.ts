import anyTest, { TestFn } from 'ava'
import { MockNotifier, Notifier } from '../../src/notifiers'
import {
  ConnectivityState,
  createConnectivityStateSubscribeFunction,
  createQueryResultSubscribeFunction,
} from '../../src/util'
import { LiveResult, LiveResultUpdate } from '../../src/client/model/model'
import { QualifiedTablename } from '../../src/util'
import EventEmitter from 'events'

const test = anyTest as TestFn<{
  notifier: Notifier
}>

function wait(durationMs?: number) {
  return new Promise((resolve) => setTimeout(resolve, durationMs))
}

function mockLiveQuery<T>(result: T, tablenames: QualifiedTablename[]) {
  let numCalls = 0
  return {
    liveQuery: async () => {
      numCalls++
      return new LiveResult(result, tablenames)
    },
    getNumCalls: () => numCalls,
  }
}

const mockDbName = 'test.db'
const mockTablename = new QualifiedTablename('public', 'bar')
const mockTablenameAlt = new QualifiedTablename('public', 'other')

test.beforeEach((t) => {
  const notifier = new MockNotifier(mockDbName, new EventEmitter())
  t.context = { notifier }
})

test('should yield update immediately upon subscribing', async (t) => {
  const { liveQuery, getNumCalls } = mockLiveQuery('foo', [mockTablename])
  const subscribe = createQueryResultSubscribeFunction(
    t.context.notifier,
    liveQuery,
    [mockTablename]
  )
  const updates: LiveResultUpdate<string>[] = []
  subscribe((u) => updates.push(u))
  await wait()

  t.is(updates.length, 1)
  t.is(getNumCalls(), 1)
  t.is(updates[0].results, 'foo')
  t.is(updates[0].error, undefined)
})

test('should yield subsequent updates as notifier signals changes', async (t) => {
  const { liveQuery, getNumCalls } = mockLiveQuery('foo', [mockTablename])
  const subscribe = createQueryResultSubscribeFunction(
    t.context.notifier,
    liveQuery,
    [mockTablename]
  )
  const updates: LiveResultUpdate<string>[] = []
  subscribe((u) => updates.push(u))
  await wait()
  t.context.notifier.actuallyChanged(
    mockDbName,
    [{ qualifiedTablename: mockTablename }],
    'local'
  )
  await wait()
  t.is(updates[1].results, 'foo')
  t.is(updates.length, 2)
  t.is(getNumCalls(), 2)
})

test('should NOT yield subsequent updates if change is to irrelevant table', async (t) => {
  const { liveQuery, getNumCalls } = mockLiveQuery('foo', [mockTablename])
  const subscribe = createQueryResultSubscribeFunction(
    t.context.notifier,
    liveQuery,
    [mockTablename]
  )
  const updates: LiveResultUpdate<string>[] = []
  subscribe((u) => updates.push(u))
  await wait()

  t.context.notifier.actuallyChanged(
    mockDbName,
    [{ qualifiedTablename: mockTablenameAlt }],
    'local'
  )
  await wait()
  t.is(updates.length, 1)
  t.is(getNumCalls(), 1)
})

test('should NOT yield subsequent updates after unsubscribing', async (t) => {
  const { liveQuery, getNumCalls } = mockLiveQuery('foo', [mockTablename])
  const subscribe = createQueryResultSubscribeFunction(
    t.context.notifier,
    liveQuery,
    [mockTablename]
  )
  const updates: LiveResultUpdate<string>[] = []
  const unsubscribe = subscribe((u) => updates.push(u))
  await wait()

  unsubscribe()
  t.context.notifier.actuallyChanged(
    mockDbName,
    [{ qualifiedTablename: mockTablename }],
    'local'
  )
  await wait()
  t.is(updates.length, 1)
  t.is(getNumCalls(), 1)
})

test('should intercept in-flight query result if unsubscribing', async (t) => {
  const { liveQuery, getNumCalls } = mockLiveQuery('foo', [mockTablename])
  const slowLiveQuery = async () => {
    await wait(100)
    return liveQuery()
  }

  const subscribe = createQueryResultSubscribeFunction(
    t.context.notifier,
    slowLiveQuery,
    [mockTablename]
  )
  const updates: LiveResultUpdate<string>[] = []
  const unsubscribe = subscribe((u) => updates.push(u))
  unsubscribe()
  await wait(200)

  // query is called, but result not returned as an update
  t.is(getNumCalls(), 1)
  t.is(updates.length, 0)
})

test('should populate relevant tablename from result if not provided', async (t) => {
  const { liveQuery, getNumCalls } = mockLiveQuery('foo', [mockTablename])
  const subscribe = createQueryResultSubscribeFunction(
    t.context.notifier,
    liveQuery,
    undefined
  )

  const updates: LiveResultUpdate<string>[] = []
  subscribe((u) => updates.push(u))
  await wait()

  // if tablename is populated, update to relevant table should trigger result
  t.context.notifier.actuallyChanged(
    mockDbName,
    [{ qualifiedTablename: mockTablename }],
    'local'
  )
  await wait()
  t.is(updates[1].results, 'foo')
  t.is(updates.length, 2)
  t.is(getNumCalls(), 2)
})

test('should return error immediately upon subscribing', async (t) => {
  const errorQuery = async () => {
    throw new Error('test')
  }

  const subscribe = createQueryResultSubscribeFunction(
    t.context.notifier,
    errorQuery,
    [mockTablename]
  )
  const updates: LiveResultUpdate<unknown>[] = []
  subscribe((u) => updates.push(u))
  await wait()

  t.is(updates.length, 1)
  t.is(updates[0].results, undefined)
  t.deepEqual(updates[0].error, new Error('test'))
})

test('should return error in subsequent updates but not interrupt', async (t) => {
  const { liveQuery } = mockLiveQuery('foo', [mockTablename])
  let ctr = 0
  const oneErrorLiveQuery = async () => {
    if (ctr++ === 1) throw new Error('test')
    return liveQuery()
  }

  const subscribe = createQueryResultSubscribeFunction(
    t.context.notifier,
    oneErrorLiveQuery,
    [mockTablename]
  )
  const updates: LiveResultUpdate<unknown>[] = []
  subscribe((u) => updates.push(u))
  await wait()
  t.is(updates.length, 1)
  t.is(updates[0].results, 'foo')
  t.is(updates[0].error, undefined)

  t.context.notifier.actuallyChanged(
    mockDbName,
    [{ qualifiedTablename: mockTablename }],
    'local'
  )
  await wait()
  t.is(updates.length, 2)
  t.is(updates[1].results, undefined)
  t.deepEqual(updates[1].error, new Error('test'))

  t.context.notifier.actuallyChanged(
    mockDbName,
    [{ qualifiedTablename: mockTablename }],
    'local'
  )
  await wait()

  t.is(updates.length, 3)
  t.is(updates[2].results, 'foo')
  t.is(updates[2].error, undefined)
})

test('should yield connectivity state updates as notifier signals them', async (t) => {
  const subscribe = createConnectivityStateSubscribeFunction(t.context.notifier)
  const states: ConnectivityState[] = []

  subscribe((s) => states.push(s))
  t.is(states.length, 0)

  t.context.notifier.connectivityStateChanged(mockDbName, {
    status: 'connected',
  })
  await wait()
  t.is(states.length, 1)
  t.is(states[0].status, 'connected')

  t.context.notifier.connectivityStateChanged(mockDbName, {
    status: 'connected',
  })
  await wait()
  t.is(states.length, 2)
  t.is(states[1].status, 'connected')

  t.context.notifier.connectivityStateChanged(mockDbName, {
    status: 'disconnected',
  })

  await wait()
  t.is(states.length, 3)
  t.is(states[2].status, 'disconnected')
})

test('should NOT yield subsequent connectivity updates after unsubscribing', async (t) => {
  const subscribe = createConnectivityStateSubscribeFunction(t.context.notifier)

  const states: ConnectivityState[] = []
  const unsubscribe = subscribe((u) => states.push(u))

  t.is(states.length, 0)

  // unsubscribing before change should not yield update
  unsubscribe()
  t.context.notifier.connectivityStateChanged(mockDbName, {
    status: 'connected',
  })

  await wait()

  t.is(states.length, 0)
})
