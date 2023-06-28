import test from 'ava'

import { InMemorySubscriptionsManager } from '../../src/util/subscriptions'
import { SubscriptionData } from '../../src/util'

type ContextType = {
  manager: InMemorySubscriptionsManager
}

test.beforeEach((t) => {
  t.context = {
    manager: new InMemorySubscriptionsManager(),
  }
})

test('some tests', (t) => {
  const { manager } = t.context as ContextType

  // the ids
  const subscriptionId = 'sub'
  const requestId = 'shaxx_1'
  const uuid = 'shape_1'
  const shapeReqToUuid = {
    [requestId]: uuid,
  }

  // the shape
  const definition = {
    selects: [
      {
        tablename: 'table',
      },
    ],
  }

  const shapeRequest = {
    requestId,
    definition,
  }

  const shapeDefinition = {
    uuid,
    definition,
  }

  const subscriptionData: SubscriptionData = {
    subscriptionId,
    data: { changes: [] },
    shapeReqToUuid,
  }

  // no active subscription while inflight
  manager.subscriptionRequested(subscriptionId, [shapeRequest])
  t.is(manager.shapesForActiveSubscription(subscriptionId), undefined)

  // active after subscription is delivered
  manager.subscriptionDelivered(subscriptionData)
  t.deepEqual(manager.shapesForActiveSubscription(subscriptionId), [
    shapeDefinition,
  ])

  // redeliver is noop
  manager.subscriptionDelivered(subscriptionData)

  // not active after unsubscribe
  manager.unsubscribe(subscriptionId)
  t.is(manager.shapesForActiveSubscription(subscriptionId), undefined)

  // able to subscribe again after unsubscribe
  try {
    manager.subscriptionRequested(subscriptionId, [shapeRequest])
  } catch {
    t.fail('throws if re-subscribing')
  }

  // but not if inflight
  try {
    manager.subscriptionRequested(subscriptionId, [shapeRequest])
    t.fail('should throw')
  } catch {
    t.pass()
  }
})
