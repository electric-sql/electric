// https://react-hooks-testing-library.com/usage/advanced-hooks#context
import test from 'ava'

import browserEnv from 'browser-env';
browserEnv()

import React from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'

import { DatabaseAdapter } from '../../src/drivers/react-native-sqlite-storage/adapter'
import { MockDatabase } from '../../src/drivers/react-native-sqlite-storage/mock'

import { DatabaseAdapter as BetterSQLiteDatabaseAdapter } from '../../src/drivers/better-sqlite3/adapter'
import { MockDatabase as MockBetterSQLiteDatabase } from '../../src/drivers/better-sqlite3/mock'
import { ElectrifiedDatabase } from '../../src/drivers/generic/index'
import { ElectricNamespace } from '../../src/electric/index'
import { MockNotifier } from '../../src/notifiers/mock'
import { QualifiedTablename } from '../../src/util/tablename'

import { useElectricQuery } from '../../src/frameworks/react/hooks'
import { ElectricProvider } from '../../src/frameworks/react/provider'

const assert = (stmt: any, msg: string = 'Assertion failed.'): void => {
  if (!stmt) {
    throw new Error(msg)
  }
}

const makeElectrified = (namespace: ElectricNamespace): ElectrifiedDatabase => {
  return {
    isGenericDatabase: true,
    isGenericElectricDatabase: true,
    electric: namespace
  }
}

test('useElectricQuery returns query results', async t => {
  const original = new MockDatabase('test.db')
  const adapter = new DatabaseAdapter(original)
  const notifier = new MockNotifier('test.db')
  const namespace = new ElectricNamespace(adapter, notifier)

  const query = 'select foo from bars'
  const wrapper = ({ children }) => {
    return (
      <ElectricProvider db={makeElectrified(namespace)}>
        { children }
      </ElectricProvider>
    )
  }

  const { result } = renderHook(() => useElectricQuery(query), { wrapper })

  await waitFor(() => assert(result.current.updatedAt !== undefined), { timeout: 1000 })
  t.deepEqual(result.current.results, await adapter.query({sql: query}))
})

test('useElectricQuery returns error when query errors', async t => {
  // We use the better-sqlite3 mock for this test because it throws an error
  // when passed `{shouldError: true}` as bind params.
  const original = new MockBetterSQLiteDatabase('test.db')
  const adapter = new BetterSQLiteDatabaseAdapter(original)

  const notifier = new MockNotifier('test.db')
  const namespace = new ElectricNamespace(adapter, notifier)

  const query = 'select foo from bars'
  const params = {shouldError: 1}

  const wrapper = ({ children }) => {
    return (
      <ElectricProvider db={makeElectrified(namespace)}>
        { children }
      </ElectricProvider>
    )
  }

  const { result } = renderHook(() => useElectricQuery(query, [params]), { wrapper })

  await waitFor(() => assert(result.current.updatedAt !== undefined), { timeout: 1000 })
  t.deepEqual(result.current.error, new Error('Mock query error'))
})

test('useElectricQuery re-runs query when data changes', async t => {
  const original = new MockDatabase('test.db')
  const adapter = new DatabaseAdapter(original)
  const notifier = new MockNotifier('test.db')
  const namespace = new ElectricNamespace(adapter, notifier)

  const query = 'select foo from bars'

  const wrapper = ({ children }) => {
    return (
      <ElectricProvider db={makeElectrified(namespace)}>
        { children }
      </ElectricProvider>
    )
  }

  const { result } = renderHook(() => useElectricQuery(query), { wrapper })
  await waitFor(() => assert(result.current.results !== undefined), { timeout: 1000 })

  const { results, updatedAt } = result.current

  act(() => {
    const qtn = new QualifiedTablename('main', 'bars')
    const changes = [{qualifiedTablename: qtn}]

    notifier.actuallyChanged('test.db', changes)
  })

  await waitFor(() => assert(result.current.updatedAt! > updatedAt!), { timeout: 1000 })
  t.not(results, result.current.results)
})

test('useElectricQuery re-runs query when *aliased* data changes', async t => {
  const original = new MockDatabase('test.db')
  const adapter = new DatabaseAdapter(original)
  const notifier = new MockNotifier('test.db')
  const namespace = new ElectricNamespace(adapter, notifier)

  await notifier.attach('baz.db', 'baz')
  const query = 'select foo from baz.bars'

  const wrapper = ({ children }) => {
    return (
      <ElectricProvider db={makeElectrified(namespace)}>
        { children }
      </ElectricProvider>
    )
  }

  const { result } = renderHook(() => useElectricQuery(query), { wrapper })
  await waitFor(() => assert(result.current.results !== undefined), { timeout: 1000 })

  const { results, updatedAt } = result.current

  act(() => {
    const qtn = new QualifiedTablename('main', 'bars')
    const changes = [{qualifiedTablename: qtn}]

    notifier.actuallyChanged('baz.db', changes)
  })

  await waitFor(() => assert(result.current.updatedAt! > updatedAt!), { timeout: 1000 })
  t.not(results, result.current.results)
})
