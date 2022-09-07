// https://react-hooks-testing-library.com/usage/advanced-hooks#context
import test from 'ava'

import browserEnv from 'browser-env';
browserEnv()

import React from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'

import { MockDatabase } from '../../src/drivers/better-sqlite3/mock'
import { QueryAdapter } from '../../src/drivers/better-sqlite3/query'
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

test('useElectricQuery returns query results', async t => {
  const original = new MockDatabase('test.db')
  const adapter = new QueryAdapter(original, 'main')
  const notifier = new MockNotifier('test.db')
  const namespace = new ElectricNamespace(notifier, adapter)

  const query = 'select foo from bars'
  const wrapper = ({ children }) => {
    return (
      <ElectricProvider db={{electric: namespace}}>
        { children }
      </ElectricProvider>
    )
  }

  const { result } = renderHook(() => useElectricQuery(query), { wrapper })

  await waitFor(() => assert(result.current.updatedAt !== undefined), {timeout: 105})
  t.deepEqual(result.current.results, await adapter.perform(query))
})

test('useElectricQuery returns error when query errors', async t => {
  const original = new MockDatabase('test.db')
  const adapter = new QueryAdapter(original, 'main')
  const notifier = new MockNotifier('test.db')
  const namespace = new ElectricNamespace(notifier, adapter)

  const query = 'select foo from bars'
  const params = {shouldError: true}

  const wrapper = ({ children }) => {
    return (
      <ElectricProvider db={{electric: namespace}}>
        { children }
      </ElectricProvider>
    )
  }

  const { result } = renderHook(() => useElectricQuery(query, params), { wrapper })

  await waitFor(() => assert(result.current.updatedAt !== undefined), {timeout: 105})
  t.deepEqual(result.current.error, new Error('Mock query error'))
})

test('useElectricQuery re-runs query when data changes', async t => {
  const original = new MockDatabase('test.db')
  const adapter = new QueryAdapter(original, 'main')
  const notifier = new MockNotifier('test.db')
  const namespace = new ElectricNamespace(notifier, adapter)

  const query = 'select foo from bars'

  const wrapper = ({ children }) => {
    return (
      <ElectricProvider db={{electric: namespace}}>
        { children }
      </ElectricProvider>
    )
  }

  const { result } = renderHook(() => useElectricQuery(query), { wrapper })
  await waitFor(() => assert(result.current.results !== undefined), {timeout: 105})

  const { results, updatedAt } = result.current

  act(() => {
    const qtn = new QualifiedTablename('main', 'bars')
    const changes = [{qualifiedTablename: qtn}]

    notifier.actuallyChanged('test.db', changes)
  })

  await waitFor(() => assert(result.current.updatedAt > updatedAt), {timeout: 105})
  t.not(results, result.current.results)
})
