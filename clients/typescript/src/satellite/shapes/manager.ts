import { SatelliteError, SatelliteErrorCode } from '../../util/types.js'

import EventEmitter from 'events'
import {
  ClientShapeDefinition,
  ShapeDefinition,
  ShapeRequest,
  ShapeRequestOrDefinition,
  SubscriptionData,
  SubscriptionId,
} from './types.js'
import { SubscriptionsManager } from './index.js'
import { hash } from 'ohash'

type SubcriptionShapeDefinitions = Record<string, ShapeDefinition[]>

type SubcriptionShapeRequests = Record<string, ShapeRequest[]>

export type GarbageCollectShapeHandler = (
  shapeDefs: ShapeDefinition[]
) => Promise<void>

export class InMemorySubscriptionsManager
  extends EventEmitter
  implements SubscriptionsManager
{
  private inFlight: SubcriptionShapeRequests = {}
  private fulfilledSubscriptions: SubcriptionShapeDefinitions = {}
  private readonly shapeRequestHashmap: Map<string, SubscriptionId> = new Map()

  private readonly gcHandler?: GarbageCollectShapeHandler

  constructor(gcHandler?: GarbageCollectShapeHandler) {
    super()
    this.gcHandler = gcHandler
  }

  subscriptionRequested(
    subId: SubscriptionId,
    shapeRequests: ShapeRequest[]
  ): void {
    if (this.inFlight[subId] || this.fulfilledSubscriptions[subId]) {
      throw new SatelliteError(
        SatelliteErrorCode.SUBSCRIPTION_ALREADY_EXISTS,
        `a subscription with id ${subId} already exists`
      )
    }

    const requestHash = computeRequestsHash(shapeRequests)

    if (this.shapeRequestHashmap.has(requestHash)) {
      throw new SatelliteError(
        SatelliteErrorCode.SUBSCRIPTION_ALREADY_EXISTS,
        `Subscription with exactly the same shape requests exists. Calling code should use "getDuplicatingSubscription" to avoid establishing same subscription twice`
      )
    }

    this.inFlight[subId] = shapeRequests
    this.shapeRequestHashmap.set(requestHash, subId)
  }

  subscriptionCancelled(subId: SubscriptionId): void {
    delete this.inFlight[subId]
    this.removeSubscriptionFromHash(subId)
  }

  subscriptionDelivered(data: SubscriptionData): void {
    const { subscriptionId, shapeReqToUuid } = data
    if (!this.inFlight[subscriptionId]) {
      // unknown, or already unsubscribed. delivery is noop
      return
    }

    const inflight = this.inFlight[subscriptionId]
    delete this.inFlight[subscriptionId]
    for (const shapeReq of inflight) {
      const resolvedRequest: ShapeDefinition = {
        uuid: shapeReqToUuid[shapeReq.requestId],
        definition: shapeReq.definition,
      }

      this.fulfilledSubscriptions[subscriptionId] =
        this.fulfilledSubscriptions[subscriptionId] ?? []
      this.fulfilledSubscriptions[subscriptionId].push(resolvedRequest)
    }
  }

  shapesForActiveSubscription(
    subId: SubscriptionId
  ): ShapeDefinition[] | undefined {
    return this.fulfilledSubscriptions[subId]
  }

  getFulfilledSubscriptions(): SubscriptionId[] {
    return Object.keys(this.fulfilledSubscriptions)
  }

  getDuplicatingSubscription(
    shapes: ClientShapeDefinition[]
  ): null | { inFlight: string } | { fulfilled: string } {
    const subId = this.shapeRequestHashmap.get(computeClientDefsHash(shapes))
    if (subId) {
      if (this.inFlight[subId]) return { inFlight: subId }
      else return { fulfilled: subId }
    } else {
      return null
    }
  }

  async unsubscribe(subId: SubscriptionId): Promise<void> {
    const shapes = this.shapesForActiveSubscription(subId)
    if (shapes) {
      if (this.gcHandler) {
        await this.gcHandler(shapes)
      }

      delete this.inFlight[subId]
      delete this.fulfilledSubscriptions[subId]
      this.removeSubscriptionFromHash(subId)
    }
  }

  async unsubscribeAll(): Promise<string[]> {
    const ids = Object.keys(this.fulfilledSubscriptions)
    for (const subId of ids) {
      await this.unsubscribe(subId)
    }
    return ids
  }

  serialize(): string {
    return JSON.stringify(this.fulfilledSubscriptions)
  }

  // TODO: input validation
  setState(serialized: string): void {
    this.inFlight = {}
    this.fulfilledSubscriptions = JSON.parse(serialized)

    this.shapeRequestHashmap.clear()
    for (const [key, value] of Object.entries(this.fulfilledSubscriptions)) {
      this.shapeRequestHashmap.set(computeRequestsHash(value), key)
    }
  }

  private removeSubscriptionFromHash(subId: SubscriptionId): void {
    // Rare enough that we can spare inefficiency of not having a reverse map
    for (const [hash, subscription] of this.shapeRequestHashmap) {
      if (subscription === subId) {
        this.shapeRequestHashmap.delete(hash)
        break
      }
    }
  }
}

function computeRequestsHash(requests: ShapeRequestOrDefinition[]): string {
  return computeClientDefsHash(requests.map((x) => x.definition))
}

function computeClientDefsHash(requests: ClientShapeDefinition[]): string {
  return hash(requests)
}
