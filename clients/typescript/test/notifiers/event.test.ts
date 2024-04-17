import test from 'ava'
import { ConnectivityStateChangeNotification } from '../../src/notifiers'

import { EventNotifier } from '../../src/notifiers/event'
import { QualifiedTablename } from '../../src/util/tablename'
import EventEmitter from 'events'

test('subscribe to potential data changes', async (t) => {
  const eventEmitter = new EventEmitter()
  const source = new EventNotifier('test.db', eventEmitter)
  const target = new EventNotifier('test.db', eventEmitter)

  const notifications = []

  target.subscribeToPotentialDataChanges((x) => {
    notifications.push(x)
  })

  source.potentiallyChanged()

  t.is(notifications.length, 1)
})

test('potential data change subscriptions are scoped by dbName(s)', async (t) => {
  const eventEmitter = new EventEmitter()
  const source = new EventNotifier('foo.db', eventEmitter)
  const t1 = new EventNotifier('foo.db', eventEmitter)
  const t2 = new EventNotifier('bar.db', eventEmitter)

  const notifications = []

  t1.subscribeToPotentialDataChanges((x) => {
    notifications.push(x)
  })
  t2.subscribeToPotentialDataChanges((x) => {
    notifications.push(x)
  })

  source.potentiallyChanged()

  t.is(notifications.length, 1)

  source.attach('bar.db', 'bar.db')
  source.potentiallyChanged()

  t.is(notifications.length, 3)
})

test('subscribe to actual data changes', async (t) => {
  const eventEmitter = new EventEmitter()
  const source = new EventNotifier('test.db', eventEmitter)
  const target = new EventNotifier('test.db', eventEmitter)

  const notifications = []

  target.subscribeToDataChanges((x) => {
    notifications.push(x)
  })

  const qualifiedTablename = new QualifiedTablename('main', 'Items')

  source.actuallyChanged('test.db', [{ qualifiedTablename }], 'local')

  t.is(notifications.length, 1)
})

test('actual data change subscriptions are scoped by dbName', async (t) => {
  const eventEmitter = new EventEmitter()
  const source = new EventNotifier('foo.db', eventEmitter)
  const t1 = new EventNotifier('foo.db', eventEmitter)
  const t2 = new EventNotifier('bar.db', eventEmitter)

  const notifications = []

  t1.subscribeToDataChanges((x) => {
    notifications.push(x)
  })
  t2.subscribeToDataChanges((x) => {
    notifications.push(x)
  })

  const qualifiedTablename = new QualifiedTablename('main', 'Items')
  const changes = [{ qualifiedTablename }]

  source.actuallyChanged('foo.db', changes, 'local')
  t.is(notifications.length, 1)

  source.actuallyChanged('lala.db', changes, 'local')
  t.is(notifications.length, 1)

  source.actuallyChanged('bar.db', changes, 'local')
  t.is(notifications.length, 1)

  source.attach('bar.db', 'bar.db')
  source.actuallyChanged('bar.db', changes, 'local')
  t.is(notifications.length, 2)

  t2.attach('foo.db', 'foo.db')
  source.actuallyChanged('foo.db', changes, 'local')
  t.is(notifications.length, 4)
})

test('subscribe to connectivity change events is scoped by dbName', async (t) => {
  const eventEmitter = new EventEmitter()
  const source = new EventNotifier('test.db', eventEmitter)
  const target = new EventNotifier('test.db', eventEmitter)

  const notifications: ConnectivityStateChangeNotification[] = []

  target.subscribeToConnectivityStateChanges((x) => {
    notifications.push(x)
  })

  source.connectivityStateChanged('test.db', { status: 'connected' })

  t.is(notifications.length, 1)

  source.connectivityStateChanged('non-existing-db', { status: 'connected' })

  t.is(notifications.length, 1)
})

test('no more connectivity events after unsubscribe', async (t) => {
  const eventEmitter = new EventEmitter()
  const source = new EventNotifier('test.db', eventEmitter)
  const target = new EventNotifier('test.db', eventEmitter)

  const notifications: ConnectivityStateChangeNotification[] = []

  const unsubscribe = target.subscribeToConnectivityStateChanges((x) => {
    notifications.push(x)
  })

  source.connectivityStateChanged('test.db', { status: 'connected' })

  unsubscribe()

  source.connectivityStateChanged('test.db', { status: 'connected' })

  t.is(notifications.length, 1)
})

test('empty changes should not emit', async (t) => {
  const source = new EventNotifier('foo.db')

  const notifications = []

  source.subscribeToDataChanges((x) => {
    notifications.push(x)
  })

  source.actuallyChanged('foo.db', [], 'local')
  t.is(notifications.length, 0)
})
