import { SatelliteError, SatelliteErrorCode } from '../../util/types'

import EventEmitter from 'events'
import {
  ShapeDefinition,
  ShapeRequest,
  ShapeRequestOrDefinition,
  SubscriptionData,
} from './types'
import { SubscriptionsManager } from '.'

type SubcriptionShapeDefinitions = Record<string, ShapeDefinition[]>

type SubcriptionShapeRequests = Record<string, ShapeRequest[]>

export type GarbageCollectShapeHandler = (
  shapeDef: ShapeDefinition
) => Promise<void>

export class InMemorySubscriptionsManager
  extends EventEmitter
  implements SubscriptionsManager
{
  private inFlight: SubcriptionShapeRequests
  private subToShapes: SubcriptionShapeDefinitions

  private gcHandler?: GarbageCollectShapeHandler

  constructor(gcHandler?: GarbageCollectShapeHandler) {
    super()

    this.inFlight = {}
    this.subToShapes = {}
    this.gcHandler = gcHandler
  }

  subscriptionRequested(subId: string, shapeRequests: ShapeRequest[]): void {
    if (this.inFlight[subId] || this.subToShapes[subId]) {
      throw new SatelliteError(
        SatelliteErrorCode.SUBSCRIPTION_ALREADY_EXISTS,
        `a subscription with id ${subId} already exists`
      )
    }

    this.inFlight[subId] = shapeRequests
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
      const shapeRequestOrResolved = shapeReq as ShapeRequestOrDefinition

      if (
        (this.subToShapes[subscriptionId] =
          this.subToShapes[subscriptionId] ?? [])
      ) {
        shapeRequestOrResolved.uuid = shapeReqToUuid[shapeReq.requestId]
        delete shapeRequestOrResolved.requestId
        this.subToShapes[subscriptionId].push(
          shapeRequestOrResolved as ShapeDefinition
        )
      }
    }
  }

  shapesForActiveSubscription(subId: string): ShapeDefinition[] | undefined {
    return this.subToShapes[subId]
  }

  async unsubscribe(subId: string): Promise<void> {
    const subscription = this.shapesForActiveSubscription(subId)
    if (subscription) {
      for (const shape of subscription) {
        if (this.gcHandler) {
          this.gcHandler(shape)
        }

        delete this.inFlight[subId]
        delete this.subToShapes[subId]
      }
    }
  }

  unsubscribeAll(): void {
    for (const subId in this.subToShapes) {
      this.unsubscribe(subId)
    }
  }

  serialize(): string {
    return JSON.stringify(this.subToShapes)
  }
}
