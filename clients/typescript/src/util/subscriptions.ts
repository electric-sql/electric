// it is actually hard to do any form of garbage

import {
  SatelliteError,
  SatelliteErrorCode,
  ShapeDefinition,
  ShapeRequest,
  ShapeRequestOrDefinition,
  SubcriptionShapeDefinitions,
} from './types'

// collection of data because of intersections
export class SubscriptionsManager {
  private inFlight: { [k: string]: ShapeRequest[] }
  private subToShapes: SubcriptionShapeDefinitions

  constructor() {
    this.inFlight = {}
    this.subToShapes = {}
  }

  subscriptionRequested(subId: string, shapeRequests: ShapeRequest[]) {
    if (this.inFlight[subId] || this.subToShapes[subId]) {
      throw new SatelliteError(
        SatelliteErrorCode.SUBSCRIPTION_ALREADY_EXISTS,
        `a subscription with id ${subId} already exists`
      )
    }

    this.inFlight[subId] = shapeRequests
  }

  subscriptionDelivered(subId: string, reqToUuid: { [k: string]: string }) {
    if (!this.inFlight[subId]) {
      // already unsubscribed. delivery is noop
      return
    }

    const inflight = this.inFlight[subId]
    delete this.inFlight[subId]
    for (const shapeReq of inflight) {
      const shapeRequestOrResolved = shapeReq as ShapeRequestOrDefinition

      if (reqToUuid[shapeReq.requestId]) {
        if (!this.subToShapes[subId]) {
          this.subToShapes[subId] = new Array()
        }

        // would like to understand how to do this properly
        shapeRequestOrResolved.uuid = reqToUuid[shapeReq.requestId]
        delete shapeRequestOrResolved.requestId
        this.subToShapes[subId].push(shapeRequestOrResolved as ShapeDefinition)
      }
    }
  }

  ShapesForActiveSubscription(subId: string): ShapeDefinition[] | undefined {
    return this.subToShapes[subId]
  }

  // note when receiving a shape, the client might already unsubscribed it
  unsubscribe(subId: string) {
    delete this.inFlight[subId]
    delete this.subToShapes[subId]
  }

  // don't save inflight subscriptions
  serialize(): SubcriptionShapeDefinitions {
    return { ...this.subToShapes }
  }
}
