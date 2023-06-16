import {
  SatelliteError,
  SatelliteErrorCode,
  ShapeDefinition,
  ShapeRequest,
  ShapeRequestOrDefinition,
} from './types'

type SubcriptionShapeDefinitions = {
  [k: string]: ShapeDefinition[]
}

type SubcriptionShapeRequests = {
  [k: string]: ShapeRequest[]
}

// it is actually hard to do any form of garbage
// collection of data because of intersections
export interface SubscriptionsManager {
  subscriptionRequested(
    subId: string,
    shapeRequests: ShapeRequest[]
  ): Promise<void>

  subscriptionDelivered(
    subId: string,
    reqToUuid: { [k: string]: string }
  ): Promise<void>

  shapesForActiveSubscription(
    subId: string
  ): Promise<ShapeDefinition[] | undefined>

  unsubscribe(subId: string): Promise<void>
}

export class InMemorySubscriptionsManager {
  protected inFlight: SubcriptionShapeRequests
  protected subToShapes: SubcriptionShapeDefinitions

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
      // unknowns, or already unsubscribed. delivery is noop
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

  shapesForActiveSubscription(subId: string): ShapeDefinition[] | undefined {
    return this.subToShapes[subId]
  }

  // note when receiving a shape, the client might already unsubscribed it
  unsubscribe(subId: string) {
    delete this.inFlight[subId]
    delete this.subToShapes[subId]
  }

  // don't save inflight subscriptions
  serialize(): string {
    return JSON.stringify(this.subToShapes)
  }

  setState(
    inFlight: SubcriptionShapeRequests,
    subToShapes: SubcriptionShapeDefinitions
  ) {
    this.inFlight = inFlight
    this.subToShapes = subToShapes
  }
}

export class PersistentSubscriptionsManager implements SubscriptionsManager {
  private manager: InMemorySubscriptionsManager
  private loadFn: () => Promise<any>
  private saveFn: (serialized: string) => Promise<void>

  constructor(
    loadFn: () => Promise<any>,
    saveFn: (value: string) => Promise<void>
  ) {
    this.manager = new InMemorySubscriptionsManager()

    this.loadFn = loadFn
    this.saveFn = saveFn
  }

  async loadStateFromStorage() {
    this.manager.setState({}, JSON.parse(await this.loadFn()))
  }

  subscriptionRequested(
    subId: string,
    shapeRequests: Required<Omit<ShapeRequestOrDefinition, 'uuid'>>[]
  ): Promise<void> {
    this.manager.subscriptionRequested(subId, shapeRequests)

    return Promise.resolve()
  }

  shapesForActiveSubscription(
    subId: string
  ): Promise<ShapeDefinition[] | undefined> {
    const res = this.manager.shapesForActiveSubscription(subId)

    return Promise.resolve(res)
  }

  subscriptionDelivered(
    subId: string,
    reqToUuid: { [k: string]: string }
  ): Promise<void> {
    this.manager.subscriptionDelivered(subId, reqToUuid)

    return this.saveFn(this.manager.serialize())
  }

  unsubscribe(subId: string): Promise<void> {
    this.manager.unsubscribe(subId)

    return this.saveFn(this.manager.serialize())
  }
}
