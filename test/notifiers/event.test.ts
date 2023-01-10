import test from 'ava'
import { ConnectivityStateChangeNotification } from '../../src/notifiers'

import { EventNotifier } from '../../src/notifiers/event'
import { ConnectivityState } from '../../src/util'
import { QualifiedTablename } from '../../src/util/tablename'

test('subscribe to potential data changes', async (t) => {
  const source = new EventNotifier('test.db')
  const target = new EventNotifier('test.db')

  const notifications = []

  target.subscribeToPotentialDataChanges((x) => {
    notifications.push(x)
  })

  source.potentiallyChanged()

  t.is(notifications.length, 1)
})

test('potential data change subscriptions are scoped by dbName(s)', async (t) => {
  const source = new EventNotifier('foo.db')
  const t1 = new EventNotifier('foo.db')
  const t2 = new EventNotifier('bar.db')

  const notifications = []

  t1.subscribeToPotentialDataChanges((x) => {
    notifications.push(x)
  })
  t2.subscribeToPotentialDataChanges((x) => {
    notifications.push(x)
  })

  source.potentiallyChanged()

  t.is(notifications.length, 1)

  source.attach('bar.db')
  source.potentiallyChanged()

  t.is(notifications.length, 3)
})

test('subscribe to actual data changes', async (t) => {
  const source = new EventNotifier('test.db')
  const target = new EventNotifier('test.db')

  const notifications = []

  target.subscribeToDataChanges((x) => {
    notifications.push(x)
  })

  const qualifiedTablename = new QualifiedTablename('main', 'items')
  const notification = {
    changes: [{ qualifiedTablename }],
  }

  source.actuallyChanged('test.db', notification)

  t.is(notifications.length, 1)
})

test('actual data change subscriptions are scoped by dbName', async (t) => {
  const source = new EventNotifier('foo.db')
  const t1 = new EventNotifier('foo.db')
  const t2 = new EventNotifier('bar.db')

  const notifications = []

  t1.subscribeToDataChanges((x) => {
    notifications.push(x)
  })
  t2.subscribeToDataChanges((x) => {
    notifications.push(x)
  })

  const qualifiedTablename = new QualifiedTablename('main', 'items')
  const notification = {
    changes: [{ qualifiedTablename }],
  }

  source.actuallyChanged('foo.db', notification)
  t.is(notifications.length, 1)

  source.actuallyChanged('lala.db', notification)
  t.is(notifications.length, 1)

  source.actuallyChanged('bar.db', notification)
  t.is(notifications.length, 1)

  source.attach('bar.db')
  source.actuallyChanged('bar.db', notification)
  t.is(notifications.length, 2)

  t2.attach('foo.db')
  source.actuallyChanged('foo.db', notification)
  t.is(notifications.length, 4)
})

test('subscribe to connectivity change events is scoped by dbName', async (t) => {
  const source = new EventNotifier('test.db')
  const target = new EventNotifier('test.db')

  const notifications: ConnectivityStateChangeNotification[] = []

  target.subscribeToConnectivityStateChange((x) => {
    notifications.push(x)
  })

  source.connectivityStateChange('test.db', 'connected')

  t.is(notifications.length, 1)

  source.connectivityStateChange('non-existing-db', 'connected')

  t.is(notifications.length, 1)
})

test('no more connectivity events after unsubscribe', async (t) => {
  const source = new EventNotifier('test.db')
  const target = new EventNotifier('test.db')

  const notifications: ConnectivityStateChangeNotification[] = []

  const key = target.subscribeToConnectivityStateChange((x) => {
    notifications.push(x)
  })

  source.connectivityStateChange('test.db', 'connected')

  target.unsubscribeFromConnectivityStateChange(key)

  source.connectivityStateChange('test.db', 'connected')

  t.is(notifications.length, 1)
})
