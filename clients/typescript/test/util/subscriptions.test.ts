import test from 'ava'

import { SubscriptionsManager } from '../../src/util/subscriptions'

type ContextType = {
  manager: SubscriptionsManager
}

test.beforeEach((t) => {
  t.context = {
    manager: new SubscriptionsManager(),
  }
})

test('some tests', (t) => {
  const { manager } = t.context as ContextType

  // the ids
  const subId = 'sub'
  const requestId = 'shaxx_1'
  const uuid = 'shape_1'
  const reqToUuid = {
    [requestId]: uuid,
  }

  // the shape
  const select = [
    {
      tablename: 'table',
    },
  ]

  const shapeRequest = {
    requestId,
    select,
  }

  const shapeDefinition = {
    uuid,
    select,
  }

  // no active subscription while inflight
  manager.subscriptionRequested(subId, [shapeRequest])
  t.is(manager.ShapesForActiveSubscription(subId), undefined)

  // active after subscription is delivered
  manager.subscriptionDelivered(subId, reqToUuid)
  t.deepEqual(manager.ShapesForActiveSubscription(subId), [shapeDefinition])

  // redeliver is noop
  manager.subscriptionDelivered(subId, reqToUuid)

  // not active after unsubscribe
  manager.unsubscribe(subId)
  t.is(manager.ShapesForActiveSubscription(subId), undefined)

  // able to subscribe again after unsubscribe
  try {
    manager.subscriptionRequested(subId, [shapeRequest])
  } catch {
    t.fail('throws if re-subscribing')
  }

  // but not if inflight
  try {
    manager.subscriptionRequested(subId, [shapeRequest])
    t.fail('should throw')
  } catch {
    t.pass()
  }
})
