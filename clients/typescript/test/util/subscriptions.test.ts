import test from 'ava'

import { relations } from '../satellite/common'
import { InMemorySubscriptionsManager } from '../../src/satellite/shapes/manager'
import {
  InitialDataChange,
  SubscriptionData,
} from '../../src/satellite/shapes/types'
import { base64 } from '../../src/util'

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
  const tablename = 'parent'
  const shapeReqToUuid = {
    [requestId]: uuid,
  }

  // the shape
  const definition = {
    selects: [
      {
        tablename,
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

  const parentRecord = {
    id: 1,
    value: 'incoming',
    other: 1,
  }

  const dataChange: InitialDataChange = {
    relation: relations[tablename],
    record: parentRecord,
    tags: [],
  }

  const subscriptionData: SubscriptionData = {
    subscriptionId,
    lsn: base64.toBytes('MTIz'),
    data: [dataChange],
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
