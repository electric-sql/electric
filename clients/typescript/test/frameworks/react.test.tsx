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

import {ResultData, useElectricQuery, useLiveQuery} from '../../src/frameworks/react/hooks'
import { makeElectricContext } from '../../src/frameworks/react/provider'
import { ElectricClient } from '../../src/client/model/client'
import { dbSchema, Electric } from '../client/generated'
import {Row} from "../../src/util";

const assert = (stmt: any, msg: string = 'Assertion failed.'): void => {
  if (!stmt) {
    throw new Error(msg)
  }
}

type FC = React.FC<React.PropsWithChildren>
type RunQueryBuilder = (adapter: DatabaseAdapter) => () => ResultData<Row[]>

const ctxInformation = makeElectricContext<Electric>()
const ElectricProvider = ctxInformation.ElectricProvider

async function testQueryResults(t: any, mkRunQuery: (adapter: DatabaseAdapter) => [() => ResultData<Row[]>, string]) {
  const original = new MockDatabase('test.db')
  const adapter = new DatabaseAdapter(original, false)
  const notifier = new MockNotifier('test.db')
  const namespace = new ElectricNamespace(adapter, notifier)
  const dal = ElectricClient.create(dbSchema, namespace)

  const [runQuery, query] = mkRunQuery(adapter)
  const wrapper: FC = ({children}) => {
    return <ElectricProvider db={dal}>{children}</ElectricProvider>
  }

  const {result} = renderHook(runQuery, {wrapper})

  await waitFor(() => assert(result.current.updatedAt !== undefined))
  t.deepEqual(result.current.results, await adapter.query({sql: query}))
}

test('useElectricQuery returns query results', async (t) => {
  await testQueryResults(t, (_adapter) => {
    const query = 'select foo from bars'
    return [
      () => useElectricQuery(query),
      query
    ]
  })
})

test('useLiveQuery returns query results', async (t) => {
  await testQueryResults(t, (adapter) => {
    const query = 'select i from bars'
    const liveQuery = mockLiveQuery(adapter, query)
    return [
      () => useLiveQuery(liveQuery),
      query
    ]
  })
})

test('useElectricQuery returns error when query errors', async (t) => {
  // We use the better-sqlite3 mock for this test because it throws an error
  // when passed `{shouldError: true}` as bind params.
  const original = new MockBetterSQLiteDatabase('test.db')
  const adapter = new BetterSQLiteDatabaseAdapter(original)

  const notifier = new MockNotifier('test.db')
  const namespace = new ElectricNamespace(adapter, notifier)
  const dal = ElectricClient.create(dbSchema, namespace)

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

test('useLiveQuery returns error when query errors', async (t) => {
  const original = new MockDatabase('test.db')
  const adapter = new DatabaseAdapter(original, false)

  const notifier = new MockNotifier('test.db')
  const namespace = new ElectricNamespace(adapter, notifier)
  const dal = ElectricClient.create(dbSchema, namespace)

  const wrapper: FC = ({ children }) => {
    return <ElectricProvider db={dal}>{children}</ElectricProvider>
  }

  const { result } = renderHook(() => useLiveQuery(mockLiveQueryError), {
    wrapper,
  })

  await waitFor(() => assert(result.current.updatedAt !== undefined), {
    timeout: 1000,
  })
  t.deepEqual(result.current.error, new Error('Mock query error'))
})

async function testReRunOnDataChange(t: any, mkRunQuery: RunQueryBuilder) {
  const original = new MockDatabase('test.db')
  const adapter = new DatabaseAdapter(original, false)
  const notifier = new MockNotifier('test.db')
  const namespace = new ElectricNamespace(adapter, notifier)
  const dal = ElectricClient.create(dbSchema, namespace)

  const runQuery = mkRunQuery(adapter)

  const wrapper: FC = ({children}) => {
    return <ElectricProvider db={dal}>{children}</ElectricProvider>
  }

  const {result} = renderHook(runQuery, {wrapper})
  await waitFor(() => assert(result.current.results !== undefined), {
    timeout: 1000,
  })

  const {results, updatedAt} = result.current

  act(() => {
    const qtn = new QualifiedTablename('main', 'bars')
    const changes = [{qualifiedTablename: qtn}]

    notifier.actuallyChanged('test.db', changes)
  })

  await waitFor(() => assert(result.current.updatedAt! > updatedAt!), {
    timeout: 1000,
  })
  t.not(results, result.current.results)
}

test('useElectricQuery re-runs query when data changes', async (t) => {
  await testReRunOnDataChange(t, (_adapter: DatabaseAdapter) => {
    const query = 'select foo from bars'
    return () => useElectricQuery(query)
  })
})

test('useLiveQuery re-runs query when data changes', async (t) => {
  await testReRunOnDataChange(t, (adapter: DatabaseAdapter) => {
    const query = 'select foo from bars'
    const liveQuery = mockLiveQuery(adapter, query)
    return () => useLiveQuery(liveQuery)
  })
})

async function testReRunWhenAliasedDataChanges(t: any, mkRunQuery: RunQueryBuilder) {
  const original = new MockDatabase('test.db')
  const adapter = new DatabaseAdapter(original, false)
  const notifier = new MockNotifier('test.db')
  const namespace = new ElectricNamespace(adapter, notifier)
  const dal = ElectricClient.create(dbSchema, namespace)

  await notifier.attach('baz.db', 'baz')

  const wrapper: FC = ({children}) => {
    return <ElectricProvider db={dal}>{children}</ElectricProvider>
  }

  const runQuery = mkRunQuery(adapter)
  const {result} = renderHook(runQuery, {wrapper})
  await waitFor(() => assert(result.current.results !== undefined), {
    timeout: 1000,
  })

  const {results, updatedAt} = result.current

  act(() => {
    const qtn = new QualifiedTablename('main', 'bars')
    const changes = [{qualifiedTablename: qtn}]

    notifier.actuallyChanged('baz.db', changes)
  })

  await waitFor(() => assert(result.current.updatedAt! > updatedAt!), {
    timeout: 1000,
  })
  t.not(results, result.current.results)
}

test('useElectricQuery re-runs query when *aliased* data changes', async (t) => {
  await testReRunWhenAliasedDataChanges(t, (_adapter: DatabaseAdapter) => {
    const query = 'select foo from baz.bars'
    return () => useElectricQuery(query)
  })
})

test('useLiveQuery re-runs query when *aliased* data changes', async (t) => {
  await testReRunWhenAliasedDataChanges(t, (adapter: DatabaseAdapter) => {
    const query = 'select foo from baz.bars'
    const liveQuery = mockLiveQuery(adapter, query)
    return () => useLiveQuery(liveQuery)
  })
})

function mockLiveQuery(adapter: DatabaseAdapter, query: string) {
  return async () => {
    const sql = { sql: query }
    const res = await adapter.query(sql)
    const tablenames = adapter.tableNames(sql)
    return {
      result: res,
      tablenames: tablenames
    }
  }
}

const mockLiveQueryError = async () => {
  throw new Error('Mock query error')
}
