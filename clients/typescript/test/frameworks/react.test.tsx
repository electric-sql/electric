import 'global-jsdom/register'
// https://react-hooks-testing-library.com/usage/advanced-hooks#context
import anyTest, { TestFn } from 'ava'

import React from 'react'
import { EventEmitter } from 'events'
import { act, renderHook, waitFor } from '@testing-library/react'

import { DatabaseAdapter } from '../../src/drivers/react-native-sqlite-storage/adapter'
import { MockDatabase } from '../../src/drivers/react-native-sqlite-storage/mock'

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
import { createQueryResultSubscribeFunction } from '../../src/util/subscribe'

const assert = (stmt: unknown, msg = 'Assertion failed.'): void => {
  if (!stmt) {
    throw new Error(msg)
  }
}

type FC = React.FC<React.PropsWithChildren>

const ctxInformation = makeElectricContext<Electric>()
const ElectricProvider = ctxInformation.ElectricProvider

const test = anyTest as TestFn<{
  dal: Electric
  adapter: DatabaseAdapter
  notifier: Notifier
}>

test.beforeEach((t) => {
  const original = new MockDatabase('test.db')
  const adapter = new DatabaseAdapter(original, false)
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
  const dal = ElectricClient.create(
    'test.db',
    schema,
    adapter,
    notifier,
    satellite,
    registry
  )

  dal.db.Items.sync()

  t.context = { dal, adapter, notifier }
})

test('liveFirst arguments are optional', async (t) => {
  const { dal } = t.context

  const liveQuery = dal.db.Items.liveFirst() // this one already fails because later down `result.current` contains an error...

  const wrapper: FC = ({ children }) => {
    return <ElectricProvider db={dal}>{children}</ElectricProvider>
  }

  const { result } = renderHook(() => useLiveQuery(liveQuery), { wrapper })

  await waitFor(() => assert(result.current.updatedAt !== undefined))

  const items = await dal.db.Items.findFirst({}) // this one fails with the same reason.. not sure why...

  t.deepEqual(result.current.results, items)
})

test('liveMany arguments are optional', async (t) => {
  const { dal } = t.context

  const liveQuery = dal.db.Items.liveMany() // this one already fails because later down `result.current` contains an error...

  const wrapper: FC = ({ children }) => {
    return <ElectricProvider db={dal}>{children}</ElectricProvider>
  }

  const { result } = renderHook(() => useLiveQuery(liveQuery), { wrapper })

  await waitFor(() => assert(result.current.updatedAt !== undefined))

  const items = await dal.db.Items.findMany({}) // this one fails with the same reason.. not sure why...

  t.deepEqual(result.current.results, items)
})

test('useLiveQuery returns query results', async (t) => {
  const { dal, adapter } = t.context

  const query = 'select i from bars'
  const liveQuery = dal.db.liveRawQuery({
    sql: query,
  })

  const wrapper: FC = ({ children }) => {
    return <ElectricProvider db={dal}>{children}</ElectricProvider>
  }

  const { result } = renderHook(() => useLiveQuery(liveQuery), { wrapper })

  await waitFor(() => assert(result.current.updatedAt !== undefined))
  t.deepEqual(result.current.results, await adapter.query({ sql: query }))
})

test('useLiveQuery returns error when query errors', async (t) => {
  const { notifier, dal } = t.context

  const wrapper: FC = ({ children }) => {
    return <ElectricProvider db={dal}>{children}</ElectricProvider>
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
  const { dal, notifier } = t.context

  const query = 'select foo from bars'
  const liveQuery = dal.db.liveRawQuery({
    sql: query,
  })

  const wrapper: FC = ({ children }) => {
    return <ElectricProvider db={dal}>{children}</ElectricProvider>
  }

  const { result } = renderHook(() => useLiveQuery(liveQuery), { wrapper })
  await waitFor(() => assert(result.current.results !== undefined), {
    timeout: 1000,
  })

  const { results, updatedAt } = result.current

  act(() => {
    const qtn = new QualifiedTablename('main', 'bars')
    const changes = [{ qualifiedTablename: qtn }]

    notifier.actuallyChanged('test.db', changes)
  })

  await waitFor(() => assert(result.current.updatedAt! > updatedAt!), {
    timeout: 1000,
  })
  t.not(results, result.current.results)
})

test('useLiveQuery re-runs query when *aliased* data changes', async (t) => {
  const { dal, notifier } = t.context

  await notifier.attach('baz.db', 'baz')

  const wrapper: FC = ({ children }) => {
    return <ElectricProvider db={dal}>{children}</ElectricProvider>
  }

  const query = 'select foo from baz.bars'
  const liveQuery = dal.db.liveRawQuery({
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

    notifier.actuallyChanged('baz.db', changes)
  })

  await waitFor(() => assert(result.current.updatedAt! > updatedAt!), {
    timeout: 1000,
  })
  t.not(results, result.current.results)
})

test('useLiveQuery never sets results if unmounted immediately', async (t) => {
  const { dal } = t.context

  const query = 'select foo from bars'
  const liveQuery = dal.db.liveRawQuery({
    sql: query,
  })

  const wrapper: FC = ({ children }) => {
    return <ElectricProvider db={dal}>{children}</ElectricProvider>
  }

  const { result, unmount } = renderHook(() => useLiveQuery(liveQuery), {
    wrapper,
  })
  unmount()

  await sleepAsync(1000)
  t.assert(result.current.results === undefined)
})

test('useLiveQuery unsubscribes to data changes when unmounted', async (t) => {
  const { dal, notifier } = t.context

  const query = 'select foo from bars'
  const liveQuery = dal.db.liveRawQuery({
    sql: query,
  })

  const wrapper: FC = ({ children }) => {
    return <ElectricProvider db={dal}>{children}</ElectricProvider>
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

    notifier.actuallyChanged('test.db', changes)
  })

  await sleepAsync(1000)
  t.assert(result.current.updatedAt === updatedAt)
})

test('useLiveQuery ignores results if unmounted whilst re-querying', async (t) => {
  const { dal, notifier } = t.context

  const query = 'select foo from bars'
  const liveQuery = dal.db.liveRawQuery({
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
    return <ElectricProvider db={dal}>{children}</ElectricProvider>
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

    notifier.actuallyChanged('test.db', changes)
    unmount()
  })

  await sleepAsync(1000)
  t.assert(result.current.updatedAt === updatedAt)
})

test('useConnectivityState defaults to disconnected', async (t) => {
  const { dal } = t.context

  const wrapper: FC = ({ children }) => {
    return <ElectricProvider db={dal}>{children}</ElectricProvider>
  }

  const { result } = renderHook(() => useConnectivityState(), { wrapper })

  await waitFor(() =>
    assert(result.current.connectivityState === 'disconnected')
  )
  t.is(result.current.connectivityState, 'disconnected')
})

test('useConnectivityState handles connectivity events', async (t) => {
  const { dal, notifier } = t.context

  const wrapper: FC = ({ children }) => {
    return <ElectricProvider db={dal}>{children}</ElectricProvider>
  }

  const { result } = renderHook(() => useConnectivityState(), { wrapper })

  notifier.connectivityStateChanged('test.db', 'connected')

  await waitFor(() => assert(result.current.connectivityState === 'connected'))
  t.is(result.current.connectivityState, 'connected')
})

test('useConnectivityState ignores connectivity events after unmounting', async (t) => {
  const { dal, notifier } = t.context

  const wrapper: FC = ({ children }) => {
    return <ElectricProvider db={dal}>{children}</ElectricProvider>
  }

  notifier.connectivityStateChanged('test.db', 'disconnected')

  const { result, unmount } = renderHook(() => useConnectivityState(), {
    wrapper,
  })
  t.is(result.current.connectivityState, 'disconnected')

  unmount()

  notifier.connectivityStateChanged('test.db', 'connected')

  await sleepAsync(1000)
  t.is(result.current.connectivityState, 'disconnected')
})
