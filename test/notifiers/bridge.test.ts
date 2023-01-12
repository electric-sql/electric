import test from 'ava'
import Worker from 'web-worker'

import {
  NotifyMethod,
  ServerMethod,
  WorkerClient,
} from '../../src/bridge/index'
import { MainThreadBridgeNotifier } from '../../src/notifiers/bridge'

const makeWorker = () => {
  return new Worker('./test/support/mock-worker.js', { type: 'module' })
}

const makeWorkerWithBridge = () => {
  return new Worker('./test/support/mock-worker-with-bridge.js', {
    type: 'module',
  })
}

const setupWorker = async () => {
  const worker = makeWorker()
  const client = new WorkerClient(worker)

  await client.request(initMethod, '<locator pattern>')
  await client.request(openMethod, 'test.db')

  const notifier = new MainThreadBridgeNotifier('test.db', client)

  return [client, notifier] as const
}

const setupBridge = async () => {
  const worker = makeWorkerWithBridge()
  const client = new WorkerClient(worker)

  await client.request(initMethod, '<locator pattern>')
  await client.request(openMethod, 'test.db')

  const notifier = new MainThreadBridgeNotifier('test.db', client)

  return [client, notifier] as const
}

const initMethod: ServerMethod = { target: 'server', name: 'init' }
const openMethod: ServerMethod = { target: 'server', name: 'open' }
const getTestData: ServerMethod = { target: 'server', name: '_get_test_data' }

const callActuallyChanged: NotifyMethod = {
  target: 'notify',
  dbName: 'test.db',
  name: 'actuallyChanged',
}

test('server is notified about potential data changes', async (t) => {
  const [client, notifier] = await setupWorker()

  notifier.potentiallyChanged()

  let testData = await client.request(getTestData, 'test.db')
  let notifications = testData.notifications
  t.is(notifications.length, 1)
})

test('client is notified about actual data changes', async (t) => {
  const [client, notifier] = await setupBridge()

  const notifications = []

  notifier.subscribeToDataChanges((x) => {
    notifications.push(x)
  })

  await client.request(callActuallyChanged, 'test.db', [])
  t.is(notifications.length, 1)
})
