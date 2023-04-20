// https://react-hooks-testing-library.com/usage/advanced-hooks#context
import test from 'ava'

import browserEnv from '@ikscodes/browser-env'
browserEnv()

import React from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'

import { DatabaseAdapter } from '../../src/drivers/react-native-sqlite-storage/adapter'
import { MockDatabase } from '../../src/drivers/react-native-sqlite-storage/mock'

import { DatabaseAdapter as BetterSQLiteDatabaseAdapter } from '../../src/drivers/better-sqlite3/adapter'
import { MockDatabase as MockBetterSQLiteDatabase } from '../../src/drivers/better-sqlite3/mock'
import { ElectricNamespace } from '../../src/electric/index'
import { MockNotifier } from '../../src/notifiers/mock'
import { QualifiedTablename } from '../../src/util/tablename'

import { useElectricQuery } from '../../src/frameworks/react/hooks'
import { makeElectricContext } from '../../src/frameworks/react/provider'
import { ElectricClient } from '../../src/client/model/client'
import { dbDescription } from '../client/generated'

const assert = (stmt: any, msg: string = 'Assertion failed.'): void => {
  if (!stmt) {
    throw new Error(msg)
  }
}

type FC = React.FC<React.PropsWithChildren>

const ctxInformation = makeElectricContext<typeof dbDescription>()
const ElectricProvider = ctxInformation.ElectricProvider

test('useElectricQuery returns query results', async (t) => {
  const original = new MockDatabase('test.db')
  const adapter = new DatabaseAdapter(original, false)
  const notifier = new MockNotifier('test.db')
  const namespace = new ElectricNamespace(adapter, notifier)
  const dal = ElectricClient.create(dbDescription, namespace)

  const query = 'select foo from bars'
  const wrapper: FC = ({ children }) => {
    return <ElectricProvider db={dal}>{children}</ElectricProvider>
  }

  const { result } = renderHook(() => useElectricQuery(query), { wrapper })

  await waitFor(() => assert(result.current.updatedAt !== undefined))
  t.deepEqual(result.current.results, await adapter.query({ sql: query }))
})

test('useElectricQuery returns error when query errors', async (t) => {
  // We use the better-sqlite3 mock for this test because it throws an error
  // when passed `{shouldError: true}` as bind params.
  const original = new MockBetterSQLiteDatabase('test.db')
  const adapter = new BetterSQLiteDatabaseAdapter(original)

  const notifier = new MockNotifier('test.db')
  const namespace = new ElectricNamespace(adapter, notifier)
  const dal = ElectricClient.create(dbDescription, namespace)

  const query = 'select foo from bars'
  const params = { shouldError: 1 }

  const wrapper: FC = ({ children }) => {
    return <ElectricProvider db={dal}>{children}</ElectricProvider>
  }

  const { result } = renderHook(() => useElectricQuery(query, params), {
    wrapper,
  })

  await waitFor(() => assert(result.current.updatedAt !== undefined), {
    timeout: 1000,
  })
  t.deepEqual(result.current.error, new Error('Mock query error'))
})

test('useElectricQuery re-runs query when data changes', async (t) => {
  const original = new MockDatabase('test.db')
  const adapter = new DatabaseAdapter(original, false)
  const notifier = new MockNotifier('test.db')
  const namespace = new ElectricNamespace(adapter, notifier)
  const dal = ElectricClient.create(dbDescription, namespace)

  const query = 'select foo from bars'

  const wrapper: FC = ({ children }) => {
    return <ElectricProvider db={dal}>{children}</ElectricProvider>
  }

  const { result } = renderHook(() => useElectricQuery(query), { wrapper })
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

test('useElectricQuery re-runs query when *aliased* data changes', async (t) => {
  const original = new MockDatabase('test.db')
  const adapter = new DatabaseAdapter(original, false)
  const notifier = new MockNotifier('test.db')
  const namespace = new ElectricNamespace(adapter, notifier)
  const dal = ElectricClient.create(dbDescription, namespace)

  await notifier.attach('baz.db', 'baz')
  const query = 'select foo from baz.bars'

  const wrapper: FC = ({ children }) => {
    return <ElectricProvider db={dal}>{children}</ElectricProvider>
  }

  const { result } = renderHook(() => useElectricQuery(query), { wrapper })
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
