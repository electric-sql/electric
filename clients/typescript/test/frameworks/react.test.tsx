import 'global-jsdom/register'
// https://react-hooks-testing-library.com/usage/advanced-hooks#context
import anyTest, { TestFn } from 'ava'

import React from 'react'
import { EventEmitter } from 'events'
import { act, renderHook, waitFor } from '@testing-library/react'

import { DatabaseAdapter, MockDatabase } from '@electric-sql/drivers/wa-sqlite'

import { MockNotifier } from '../../src/notifiers/mock'
import { QualifiedTablename } from '../../src/util/tablename'
import { sleepAsync } from '../../src/util/timer'

import {
  useConnectivityState,
  useLiveQuery,
} from '../../src/frameworks/react/hooks'
import { makeElectricContext } from '../../src/frameworks/react/provider'
import { ElectricClient } from '../../src/client/model/client'
import { schema, Electric } from '../client/generated'
import { MockRegistry, MockSatelliteProcess } from '../../src/satellite/mock'
import { Migrator } from '../../src/migrators'
import { SocketFactory } from '../../src/sockets'
import { SatelliteOpts } from '../../src/satellite/config'
import { Notifier } from '../../src/notifiers'
import { createQueryResultSubscribeFunction } from '../../src/util'

const assert = (stmt: unknown, msg = 'Assertion failed.'): void => {
  if (!stmt) {
    throw new Error(msg)
  }
}

type FC = React.FC<React.PropsWithChildren>

const ctxInformation = makeElectricContext<Electric>()
const ElectricProvider = ctxInformation.ElectricProvider

const test = anyTest as TestFn<{
  electric: Electric
  adapter: DatabaseAdapter
  notifier: Notifier
}>

test.beforeEach((t) => {
  const original = new MockDatabase('test.db')
  const adapter = new DatabaseAdapter(original)
  const notifier = new MockNotifier('test.db', new EventEmitter())
  const satellite = new MockSatelliteProcess(
    'test.db',
    adapter,
    {} as Migrator,
    notifier,
    {} as SocketFactory,
    {} as SatelliteOpts
  )
  const registry = new MockRegistry()
  const electric = ElectricClient.create(
    'test.db',
    schema,
    adapter,
    notifier,
    satellite,
    registry,
    'SQLite'
  )

  electric.sync.subscribe({ table: 'Items' })

  t.context = { electric, adapter, notifier }
})

test('useLiveQuery returns query results', async (t) => {
  const { electric, adapter } = t.context

  const query = 'select i from bars'
  const liveQuery = electric.db.liveRawQuery({
    sql: query,
  })

  const wrapper: FC = ({ children }) => {
    return <ElectricProvider db={electric}>{children}</ElectricProvider>
  }

  const { result } = renderHook(() => useLiveQuery(liveQuery), { wrapper })

  await waitFor(() => assert(result.current.updatedAt !== undefined))
  t.deepEqual(result.current.results, await adapter.query({ sql: query }))
})

test('useLiveQuery returns error when query errors', async (t) => {
  const { notifier, electric } = t.context

  const wrapper: FC = ({ children }) => {
    return <ElectricProvider db={electric}>{children}</ElectricProvider>
  }

  const errorLiveQuery = async () => {
    throw new Error('Mock query error')
  }

  errorLiveQuery.subscribe = createQueryResultSubscribeFunction(
    notifier,
    errorLiveQuery
  )

  const { result } = renderHook(() => useLiveQuery(errorLiveQuery), {
    wrapper,
  })

  await waitFor(() => assert(result.current.updatedAt !== undefined), {
    timeout: 1000,
  })
  t.deepEqual(result.current.error, new Error('Mock query error'))
})

test('useLiveQuery re-runs query when data changes', async (t) => {
  const { electric, notifier } = t.context

  const query = 'select foo from bars'
  const liveQuery = electric.db.liveRawQuery({
    sql: query,
  })

  const wrapper: FC = ({ children }) => {
    return <ElectricProvider db={electric}>{children}</ElectricProvider>
  }

  const { result } = renderHook(() => useLiveQuery(liveQuery), { wrapper })
  await waitFor(() => assert(result.current.results !== undefined), {
    timeout: 1000,
  })

  const { results, updatedAt } = result.current

  act(() => {
    const qtn = new QualifiedTablename('main', 'bars')
    const changes = [{ qualifiedTablename: qtn }]

    notifier.actuallyChanged('test.db', changes, 'local')
  })

  await waitFor(() => assert(result.current.updatedAt! > updatedAt!), {
    timeout: 1000,
  })
  t.not(results, result.current.results)
})

test('useLiveQuery re-runs query when *aliased* data changes', async (t) => {
  const { electric, notifier } = t.context

  await notifier.attach('baz.db', 'baz')

  const wrapper: FC = ({ children }) => {
    return <ElectricProvider db={electric}>{children}</ElectricProvider>
  }

  const query = 'select foo from baz.bars'
  const liveQuery = electric.db.liveRawQuery({
    sql: query,
  })

  const { result } = renderHook(() => useLiveQuery(liveQuery), { wrapper })
  await waitFor(() => assert(result.current.results !== undefined), {
    timeout: 1000,
  })

  const { results, updatedAt } = result.current

  act(() => {
    const qtn = new QualifiedTablename('main', 'bars')
    const changes = [{ qualifiedTablename: qtn }]

    notifier.actuallyChanged('baz.db', changes, 'local')
  })

  await waitFor(() => assert(result.current.updatedAt! > updatedAt!), {
    timeout: 1000,
  })
  t.not(results, result.current.results)
})

test('useLiveQuery never sets results if unmounted immediately', async (t) => {
  const { electric } = t.context

  const query = 'select foo from bars'
  const liveQuery = electric.db.liveRawQuery({
    sql: query,
  })

  const wrapper: FC = ({ children }) => {
    return <ElectricProvider db={electric}>{children}</ElectricProvider>
  }

  const { result, unmount } = renderHook(() => useLiveQuery(liveQuery), {
    wrapper,
  })
  unmount()

  await sleepAsync(1000)
  t.assert(result.current.results === undefined)
})

test('useLiveQuery unsubscribes to data changes when unmounted', async (t) => {
  const { electric, notifier } = t.context

  const query = 'select foo from bars'
  const liveQuery = electric.db.liveRawQuery({
    sql: query,
  })

  const wrapper: FC = ({ children }) => {
    return <ElectricProvider db={electric}>{children}</ElectricProvider>
  }

  const { result, unmount } = renderHook(() => useLiveQuery(liveQuery), {
    wrapper,
  })
  await waitFor(() => assert(result.current.results !== undefined), {
    timeout: 1000,
  })

  const { updatedAt } = result.current
  t.assert(updatedAt !== undefined)

  act(() => {
    unmount()

    const qtn = new QualifiedTablename('main', 'bars')
    const changes = [{ qualifiedTablename: qtn }]

    notifier.actuallyChanged('test.db', changes, 'local')
  })

  await sleepAsync(1000)
  t.assert(result.current.updatedAt === updatedAt)
})

test('useLiveQuery ignores results if unmounted whilst re-querying', async (t) => {
  const { electric, notifier } = t.context

  const query = 'select foo from bars'
  const liveQuery = electric.db.liveRawQuery({
    sql: query,
  })
  const slowLiveQuery = async () => {
    await sleepAsync(100)
    return await liveQuery()
  }

  slowLiveQuery.subscribe = createQueryResultSubscribeFunction(
    notifier,
    slowLiveQuery
  )

  const wrapper: FC = ({ children }) => {
    return <ElectricProvider db={electric}>{children}</ElectricProvider>
  }

  const { result, unmount } = renderHook(() => useLiveQuery(slowLiveQuery), {
    wrapper,
  })
  await waitFor(() => assert(result.current.results !== undefined), {
    timeout: 1000,
  })

  const { updatedAt } = result.current
  t.assert(updatedAt !== undefined)

  act(() => {
    const qtn = new QualifiedTablename('main', 'bars')
    const changes = [{ qualifiedTablename: qtn }]

    notifier.actuallyChanged('test.db', changes, 'local')
    unmount()
  })

  await sleepAsync(1000)
  t.assert(result.current.updatedAt === updatedAt)
})

test('useConnectivityState defaults to disconnected', async (t) => {
  const { electric } = t.context

  const wrapper: FC = ({ children }) => {
    return <ElectricProvider db={electric}>{children}</ElectricProvider>
  }

  const { result } = renderHook(() => useConnectivityState(), { wrapper })

  await waitFor(() => assert(result.current.status === 'disconnected'))
  t.is(result.current.status, 'disconnected')
})

test('useConnectivityState handles connectivity events', async (t) => {
  const { electric, notifier } = t.context

  const wrapper: FC = ({ children }) => {
    return <ElectricProvider db={electric}>{children}</ElectricProvider>
  }

  const { result } = renderHook(() => useConnectivityState(), { wrapper })

  notifier.connectivityStateChanged('test.db', { status: 'connected' })

  await waitFor(() => assert(result.current.status === 'connected'))
  t.is(result.current.status, 'connected')
})

test('useConnectivityState ignores connectivity events after unmounting', async (t) => {
  const { electric, notifier } = t.context

  const wrapper: FC = ({ children }) => {
    return <ElectricProvider db={electric}>{children}</ElectricProvider>
  }

  notifier.connectivityStateChanged('test.db', { status: 'disconnected' })

  const { result, unmount } = renderHook(() => useConnectivityState(), {
    wrapper,
  })
  t.is(result.current.status, 'disconnected')

  unmount()

  notifier.connectivityStateChanged('test.db', { status: 'connected' })

  await sleepAsync(1000)
  t.is(result.current.status, 'disconnected')
})
