import 'global-jsdom/register'
import anyTest, { TestFn } from 'ava'
import {
  makeElectricDependencyInjector,
  useLiveQuery,
} from '../../src/frameworks/vuejs'
import { mount, shallowMount, flushPromises } from '@vue/test-utils'
import { computed, defineComponent, shallowRef, ref, isProxy, watch } from 'vue'

import { DatabaseAdapter } from '../../src/drivers/wa-sqlite/adapter'
import { MockDatabase } from '../../src/drivers/wa-sqlite/mock'

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

const { provideElectric, injectElectric } =
  makeElectricDependencyInjector<Electric>()

const test = anyTest as TestFn<{
  dal: Electric
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

  const wrapper = shallowMount({
    template: '<div>count: {{ count }}</div>',
    setup() {
      const { results } = useLiveQuery(liveQuery)
      const count = computed(() => results?.value?.[0].count ?? 0)
      return { count }
    },
  })

  t.is(wrapper.vm.count as number, 0)
  await flushPromises()
  t.is(wrapper.vm.count as number, 2)
  wrapper.unmount()
})

test('useLiveQuery returns error when query errors', async (t) => {
  const { notifier } = t.context

  const expectedError = new Error('Mock query error')

  const errorLiveQuery = () => Promise.reject(expectedError)
  errorLiveQuery.sourceQuery = { sql: '' }
  errorLiveQuery.subscribe = createQueryResultSubscribeFunction(
    notifier,
    errorLiveQuery
  )

  const wrapper = shallowMount({
    template: '<div></div>',
    setup() {
      const { results, error } = useLiveQuery(errorLiveQuery)
      return { results, error }
    },
  })

  t.is(wrapper.vm.results as unknown, undefined)
  t.is(wrapper.vm.error as unknown, undefined)
  await flushPromises()
  t.is(wrapper.vm.results as unknown, undefined)
  t.deepEqual(wrapper.vm.error as unknown, new Error('Mock query error'))
  wrapper.unmount()
})

test('useLiveQuery re-runs query when data changes', async (t) => {
  const { dal, adapter, notifier } = t.context

  const query = 'select foo from bars'
  adapter.query = async () => [{ count: 2 }]
  const liveQuery = dal.db.liveRawQuery({
    sql: query,
  })

  const wrapper = shallowMount({
    template: '<div>count: {{ count }}</div>',
    setup() {
      const { results, updatedAt } = useLiveQuery(liveQuery)
      const count = computed(() => results?.value?.[0].count ?? 0)
      return { count, updatedAt }
    },
  })

  t.is(wrapper.vm.count as number, 0)
  await flushPromises()
  t.is(wrapper.vm.count as number, 2)

  // keep track of first update time
  const firstUpdateTime = wrapper.vm.updatedAt as Date
  t.true(firstUpdateTime instanceof Date)

  // trigger notifier
  adapter.query = async () => [{ count: 3 }]
  notifier.actuallyChanged('test.db', [
    { qualifiedTablename: new QualifiedTablename('main', 'bars') },
  ])

  await flushPromises()

  t.is(wrapper.vm.count as number, 3)
  const secondUpdateTime = wrapper.vm.updatedAt as Date
  t.true(secondUpdateTime > firstUpdateTime)
  wrapper.unmount()
})

test('useLiveQuery never runs query if unmounted immediately', async (t) => {
  const { dal, adapter } = t.context
  adapter.query = async () => [{ count: 2 }]
  const query = 'select foo from bars'
  const liveQuery = dal.db.liveRawQuery({
    sql: query,
  })

  const wrapper = shallowMount({
    template: '<div>count: {{ count }}</div>',
    setup() {
      const { results } = useLiveQuery(liveQuery)
      const count = computed(() => results?.value?.[0].count ?? 0)
      return { count }
    },
  })
  await wrapper.unmount()

  await flushPromises()
  t.is(wrapper.vm.count as number, 0)
  wrapper.unmount()
})

test('useLiveQuery unsubscribes to data changes when unmounted', async (t) => {
  const { dal, adapter, notifier } = t.context

  const query = 'select foo from bars'
  adapter.query = async () => [{ count: 2 }]
  const liveQuery = dal.db.liveRawQuery({
    sql: query,
  })

  let reactiveUpdatesTriggered = 0
  const wrapper = shallowMount({
    template: '<div>count: {{ count }}</div>',
    setup() {
      const { results, updatedAt } = useLiveQuery(liveQuery)
      const count = computed(() => results?.value?.[0].count ?? 0)
      watch([updatedAt], () => reactiveUpdatesTriggered++)
      return { count }
    },
  })

  await flushPromises()
  const firstUpdateTime = wrapper.vm.updatedAt as Date
  t.is(reactiveUpdatesTriggered, 1)

  // trigger notifier after unmounting
  await wrapper.unmount()
  adapter.query = async () => [{ count: 3 }]
  const qtn = new QualifiedTablename('main', 'bars')
  const changes = [{ qualifiedTablename: qtn }]
  notifier.actuallyChanged('test.db', changes)

  // no updates triggered
  await flushPromises()
  const secondUpdateTime = wrapper.vm.updatedAt as Date
  t.is(secondUpdateTime, firstUpdateTime)
  t.is(reactiveUpdatesTriggered, 1)
  wrapper.unmount()
})

test('useLiveQuery ignores results if unmounted whilst re-querying', async (t) => {
  const { dal, adapter, notifier } = t.context

  const query = 'select foo from bars'
  adapter.query = async () => [{ count: 2 }]
  const liveQuery = dal.db.liveRawQuery({
    sql: query,
  })

  let reactiveUpdatesTriggered = 0
  const wrapper = shallowMount({
    template: '<div>count: {{ count }}</div>',
    setup() {
      const { results, updatedAt } = useLiveQuery(liveQuery)
      const count = computed(() => results?.value?.[0].count ?? 0)
      watch([updatedAt], () => reactiveUpdatesTriggered++)
      return { count }
    },
  })

  await flushPromises()
  const firstUpdateTime = wrapper.vm.updatedAt as Date
  t.is(reactiveUpdatesTriggered, 1)

  // trigger notifier and _then_ immediately unmount

  adapter.query = async () => [{ count: 3 }]
  const qtn = new QualifiedTablename('main', 'bars')
  const changes = [{ qualifiedTablename: qtn }]
  notifier.actuallyChanged('test.db', changes)
  await wrapper.unmount()

  // no updates triggered
  await flushPromises()
  const secondUpdateTime = wrapper.vm.updatedAt as Date
  t.is(secondUpdateTime, firstUpdateTime)
  t.is(reactiveUpdatesTriggered, 1)
  wrapper.unmount()
})

test('useLiveQuery re-runs reffed query when live query arguments change', async (t) => {
  const { dal, adapter } = t.context

  adapter.query = async ({ sql }) => [{ count: sql.includes('foo') ? 2 : 3 }]
  const wrapper = shallowMount({
    template: '<div>count: {{ count }}</div>',
    setup() {
      const columnToSelect = ref('foo')
      const { results, updatedAt } = useLiveQuery(
        computed(() =>
          dal.db.liveRawQuery({
            sql: `select ${columnToSelect.value} from bars`,
          })
        )
      )
      setTimeout(() => (columnToSelect.value = 'other'), 500)
      const count = computed(() => results?.value?.[0].count ?? 0)
      return { count, updatedAt }
    },
  })

  await flushPromises()
  t.is(wrapper.vm.count as number, 2)
  const firstUpdateTime = wrapper.vm.updatedAt as Date

  await sleepAsync(600)
  await flushPromises()
  t.is(wrapper.vm.count as number, 3)
  const secondUpdateTime = wrapper.vm.updatedAt as Date
  t.true(secondUpdateTime > firstUpdateTime)
  wrapper.unmount()
})

test('useLiveQuery re-runs func query when live query arguments change', async (t) => {
  const { dal, adapter } = t.context

  adapter.query = async ({ sql }) => [{ count: sql.includes('foo') ? 2 : 3 }]
  const wrapper = shallowMount({
    template: '<div>count: {{ count }}</div>',
    setup() {
      const columnToSelect = ref('foo')
      const { results, updatedAt } = useLiveQuery(() =>
        dal.db.liveRawQuery({
          sql: `select ${columnToSelect.value} from bars`,
        })
      )
      setTimeout(() => (columnToSelect.value = 'other'), 500)
      const count = computed(() => results?.value?.[0].count ?? 0)
      return { count, updatedAt }
    },
  })

  await flushPromises()
  t.is(wrapper.vm.count as number, 2)
  const firstUpdateTime = wrapper.vm.updatedAt as Date

  await sleepAsync(600)
  await flushPromises()
  t.is(wrapper.vm.count as number, 3)
  const secondUpdateTime = wrapper.vm.updatedAt as Date
  t.true(secondUpdateTime > firstUpdateTime)
  wrapper.unmount()
})

test('useLiveQuery re-runs static query when dependencies change', async (t) => {
  const { dal, adapter } = t.context

  adapter.query = async () => [{ count: 2 }]
  const wrapper = shallowMount({
    template: '<div>count: {{ count }}</div>',
    setup() {
      const arbitraryDependency = ref('a')
      const { results, updatedAt } = useLiveQuery(
        dal.db.liveRawQuery({
          sql: `select foo from bars`,
        }),
        [arbitraryDependency]
      )
      setTimeout(() => {
        arbitraryDependency.value = 'b'
      }, 200)
      const count = computed(() => results?.value?.[0].count ?? 0)
      return { count, updatedAt }
    },
  })

  await flushPromises()
  const firstUpdateTime = wrapper.vm.updatedAt as Date

  await sleepAsync(300)
  await flushPromises()
  const secondUpdateTime = wrapper.vm.updatedAt as Date
  t.true(secondUpdateTime > firstUpdateTime)
  wrapper.unmount()
})

test('dependency injection works without reference to client', async (t) => {
  const { dal, adapter } = t.context
  adapter.query = async () => [{ count: 2 }]

  const ProviderComponent = defineComponent({
    template: '<div v-if={show}><slot/></div>',
    setup() {
      provideElectric(dal)
      return { show: true }
    },
  })

  const ConsumerComponent = defineComponent({
    template: '<div>count: {{ count }}</div>',
    setup() {
      const electric = injectElectric()!
      const liveQuery = electric.db.liveRawQuery({
        sql: 'select foo from bars',
      })
      const { results } = useLiveQuery(liveQuery)
      const count = computed(() => results?.value?.[0].count ?? 0)
      return { count }
    },
  })

  const wrapper = mount({
    template: '<ProviderComponent><ConsumerComponent/></ProviderComponent>',
    components: { ProviderComponent, ConsumerComponent },
  })

  await flushPromises()
  t.is(wrapper.text(), 'count: 2')
  wrapper.unmount()
})

test('dependency injection works with shallow reference to client', async (t) => {
  const { dal, adapter } = t.context
  adapter.query = async () => [{ count: 2 }]

  const ProviderComponent = defineComponent({
    template: '<div v-if=show><slot/></div>',
    setup() {
      const client = shallowRef<Electric>()
      const show = computed(() => client.value !== undefined)
      setTimeout(() => (client.value = dal), 200)
      provideElectric(client)
      return { show }
    },
  })

  let electricInstance: Electric | undefined

  const ConsumerComponent = defineComponent({
    template: '<div>count: {{ count }}</div>',
    setup() {
      const electric = injectElectric()!
      electricInstance = electric
      const liveQuery = electric.db.liveRawQuery({
        sql: 'select foo from bars',
      })

      const { results } = useLiveQuery(liveQuery)
      const count = computed(() => results?.value?.[0].count ?? 0)
      return { count }
    },
  })

  const wrapper = mount({
    template: '<ProviderComponent><ConsumerComponent/></ProviderComponent>',
    components: { ProviderComponent, ConsumerComponent },
  })

  await flushPromises()
  t.is(wrapper.text(), '')
  await sleepAsync(300)
  await flushPromises()
  t.is(wrapper.text(), 'count: 2')

  // consumer's instance should not be a proxy
  t.assert(!isProxy(electricInstance))
  wrapper.unmount()
})

test('dependency injection works with deep reference to client but is proxy', async (t) => {
  const { dal, adapter } = t.context
  adapter.query = async () => [{ count: 2 }]

  const ProviderComponent = defineComponent({
    template: '<div v-if=show><slot/></div>',
    setup() {
      const client = ref<Electric>()
      const show = computed(() => client.value !== undefined)
      setTimeout(() => (client.value = dal), 200)
      provideElectric(client)
      return { show }
    },
  })

  let electricInstance: Electric | undefined

  const ConsumerComponent = defineComponent({
    template: '<div>count: {{ count }}</div>',
    setup() {
      const electric = injectElectric()!
      electricInstance = electric
      const liveQuery = electric.db.liveRawQuery({
        sql: 'select foo from bars',
      })
      const { results } = useLiveQuery(liveQuery)
      const count = computed(() => results?.value?.[0].count ?? 0)
      return { count }
    },
  })

  const wrapper = mount({
    template: '<ProviderComponent><ConsumerComponent/></ProviderComponent>',
    components: { ProviderComponent, ConsumerComponent },
  })

  await flushPromises()
  t.is(wrapper.text(), '')
  await sleepAsync(300)
  await flushPromises()
  t.is(wrapper.text(), 'count: 2')

  // consumer's instance will be a proxy
  t.assert(isProxy(electricInstance))
  wrapper.unmount()
})
