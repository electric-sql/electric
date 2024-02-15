import anyTest, { TestFn } from 'ava'

import { DatabaseAdapter } from '../../src/drivers/react-native-sqlite-storage/adapter'
import { MockDatabase } from '../../src/drivers/react-native-sqlite-storage/mock'

import { MockNotifier } from '../../src/notifiers/mock'
import { QualifiedTablename } from '../../src/util/tablename'
import { sleepAsync } from '../../src/util/timer'
import { ElectricClient } from '../../src/client/model/client'
import { schema, Electric } from '../client/generated'
import { MockRegistry, MockSatelliteProcess } from '../../src/satellite/mock'
import { Migrator } from '../../src/migrators'
import { SocketFactory } from '../../src/sockets'
import { SatelliteOpts } from '../../src/satellite/config'
import { Notifier } from '../../src/notifiers'
import { createQueryResultSubscribeFunction } from '../../src/util/subscribe'
import EventEmitter from 'events'

// TODO(msfstef): hacky way to ensure vue has access to browser environment
// maybe should switch to other testing solution (e.g. Vitest)?
import browserEnv from '@ikscodes/browser-env'
browserEnv()
const { useLiveQuery, makeElectricDependencyInjector } = await import(
  '../../src/frameworks/vuejs'
)
const { render, screen, waitFor } = await import('@testing-library/vue')
const { watchEffect, computed } = await import('vue')

const assert = (stmt: any, msg = 'Assertion failed.'): void => {
  if (!stmt) {
    throw new Error(msg)
  }
}

// const { provideElectric, injectElectric } =
//   makeElectricDependencyInjector<Electric>()

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

test('useLiveQuery returns query results', async (t) => {
  const { dal, adapter } = t.context

  const query = 'select i from bars'
  adapter.query = async () => [{ count: 2 }]
  const liveQuery = dal.db.liveRawQuery({ sql: query })

  const { unmount } = render({
    template: '<div>count: {{ count }}</div>',
    setup() {
      const { results } = useLiveQuery(liveQuery)
      const count = computed(() => results?.value?.[0].count ?? 0)
      return { count }
    },
  })

  t.not(screen.getByText('count: 0'), null)
  await waitFor(() => t.not(screen.getByText('count: 2'), null))
  await unmount()
})

test('useLiveQuery returns error when query errors', async (t) => {
  const { notifier } = t.context

  const expectedError = new Error('Mock query error')

  const errorLiveQuery = async () => {
    throw expectedError
  }
  errorLiveQuery.subscribe = createQueryResultSubscribeFunction(
    notifier,
    errorLiveQuery
  )
  let errorEmitted: unknown
  const { unmount } = render({
    template: '<div></div>',
    setup() {
      const { error } = useLiveQuery(errorLiveQuery)
      watchEffect(() => {
        errorEmitted = error?.value
      })
    },
  })

  await waitFor(() => assert(errorEmitted !== undefined))
  t.deepEqual(errorEmitted, expectedError)
  await unmount()
})

test('useLiveQuery re-runs query when data changes', async (t) => {
  const { dal, adapter, notifier } = t.context

  const query = 'select foo from bars'
  adapter.query = async () => [{ count: 2 }]
  const liveQuery = dal.db.liveRawQuery({
    sql: query,
  })

  let lastUpdateTime: Date | undefined

  const { unmount } = render({
    template: '<div>count: {{ count }}</div>',
    setup() {
      const { results, updatedAt } = useLiveQuery(liveQuery)
      const count = computed(() => results?.value?.[0].count ?? 0)
      watchEffect(() => {
        lastUpdateTime = updatedAt?.value
      })
      return { count }
    },
  })

  await waitFor(() => screen.getByText('count: 2'))
  // keep track of first update time
  const firstUpdateTime = lastUpdateTime as Date
  t.true(firstUpdateTime instanceof Date)

  // trigger notifier
  adapter.query = async () => [{ count: 3 }]
  const qtn = new QualifiedTablename('main', 'bars')
  const changes = [{ qualifiedTablename: qtn }]
  notifier.actuallyChanged('test.db', changes)

  await waitFor(() => screen.getByText('count: 3'))
  const secondUpdateTime = lastUpdateTime as Date
  t.true(secondUpdateTime > firstUpdateTime)
  await unmount()
})

test('useLiveQuery never sets results if unmounted immediately', async (t) => {
  const { dal } = t.context

  const query = 'select foo from bars'
  const liveQuery = dal.db.liveRawQuery({
    sql: query,
  })

  let renderedResults

  const { unmount } = render({
    template: '<div>count: {{ count }}</div>',
    setup() {
      const { results } = useLiveQuery(liveQuery)
      const count = computed(() => results?.value?.[0].count ?? 0)
      watchEffect(() => {
        renderedResults = results?.value
      })
      return { count }
    },
  })
  await unmount()

  await sleepAsync(1000)
  t.assert(renderedResults === undefined)
})

test('useLiveQuery unsubscribes to data changes when unmounted', async (t) => {
  const { dal, adapter, notifier } = t.context

  const query = 'select foo from bars'
  adapter.query = async () => [{ count: 2 }]
  const liveQuery = dal.db.liveRawQuery({
    sql: query,
  })

  let reactiveUpdatesTriggered = 0
  let lastUpdateTime: Date | undefined

  const { unmount } = render({
    template: '<div>count: {{ count }}</div>',
    setup() {
      const { results, updatedAt } = useLiveQuery(liveQuery)
      const count = computed(() => results?.value?.[0].count ?? 0)
      watchEffect(() => {
        reactiveUpdatesTriggered++
        lastUpdateTime = updatedAt?.value
      })
      return { count }
    },
  })

  await waitFor(() => screen.getByText('count: 2'))
  const firstUpdateTime = lastUpdateTime
  t.assert(firstUpdateTime instanceof Date)
  t.is(reactiveUpdatesTriggered, 2)

  // trigger notifier after unmounting
  await unmount()
  adapter.query = async () => [{ count: 3 }]
  const qtn = new QualifiedTablename('main', 'bars')
  const changes = [{ qualifiedTablename: qtn }]
  notifier.actuallyChanged('test.db', changes)

  // no updates triggered
  await sleepAsync(1000)
  const secondUpdateTime = lastUpdateTime
  t.is(secondUpdateTime, firstUpdateTime)
  t.is(reactiveUpdatesTriggered, 2)
})

test('useLiveQuery ignores results if unmounted whilst re-querying', async (t) => {
  const { dal, adapter, notifier } = t.context

  const query = 'select foo from bars'
  adapter.query = async () => [{ count: 2 }]
  const liveQuery = dal.db.liveRawQuery({
    sql: query,
  })

  let reactiveUpdatesTriggered = 0
  let lastUpdateTime: Date | undefined

  const { unmount } = render({
    template: '<div>count: {{ count }}</div>',
    setup() {
      const { results, updatedAt } = useLiveQuery(liveQuery)
      const count = computed(() => results?.value?.[0].count ?? 0)
      watchEffect(() => {
        reactiveUpdatesTriggered++
        lastUpdateTime = updatedAt?.value
      })
      return { count }
    },
  })

  await waitFor(() => screen.getByText('count: 2'))
  const firstUpdateTime = lastUpdateTime
  t.assert(firstUpdateTime instanceof Date)
  t.is(reactiveUpdatesTriggered, 2)

  // trigger notifier and _then_ immediately unmount

  adapter.query = async () => [{ count: 3 }]
  const qtn = new QualifiedTablename('main', 'bars')
  const changes = [{ qualifiedTablename: qtn }]
  notifier.actuallyChanged('test.db', changes)
  await unmount()

  // no updates triggered
  await sleepAsync(1000)
  const secondUpdateTime = lastUpdateTime
  t.is(secondUpdateTime, firstUpdateTime)
  t.is(reactiveUpdatesTriggered, 2)
})
