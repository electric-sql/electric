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
const { render, fireEvent, screen } = await import('@testing-library/vue')
const { computed } = await import('vue')

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
  const { dal, adapter, notifier } = t.context

  const query = 'select i from bars'
  adapter.query = async () => [{ count: 2 }]
  const { unmount } = render({
    template: '<div>count: {{ count }}</div>',
    setup() {
      const { db } = dal
      const { results } = useLiveQuery(db.liveRawQuery({ sql: query }))
      const count = computed(() => results?.value?.[0].count ?? 0)
      return { count }
    },
  })

  t.notThrows(() => screen.getByText('count: 0'))
  await new Promise((res) => setTimeout(res))
  t.notThrows(() => screen.getByText('count: 2'))
  await unmount()
})
