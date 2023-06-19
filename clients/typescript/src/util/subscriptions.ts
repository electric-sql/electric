import {
  SatelliteError,
  SatelliteErrorCode,
  ShapeDefinition,
  ShapeRequest,
  ShapeRequestOrDefinition,
  SubscriptionData,
} from './types'

import {
  SatSubsDataBegin, // todo: fix proto
  SatShapeDataBegin,
  SatOpLog,
} from '../_generated/protocol/satellite'

type SubcriptionShapeDefinitions = {
  [k: string]: ShapeDefinition[]
}

type SubcriptionShapeRequests = {
  [k: string]: ShapeRequest[]
}

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

export class SubscriptionsDataCache {
  shapesRequested?: number
  remainingShapes?: number
  currentSubscriptionId?: string
  currentShapeUuid?: string
  inDelivery?: SubscriptionData

  constructor() {}

  subscriptionRequest(shapeCount: number) {
    if (this.remainingShapes || this.currentSubscriptionId) {
      this.reset()
      throw new SatelliteError(
        SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
        `received subscription request but a subscription is already being delivered`
      )
    }
    this.shapesRequested = shapeCount
  }

  subscriptionResponse() {
    if (!this.shapesRequested) {
      this.reset()
      throw new SatelliteError(
        SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
        `Received subscribe response but no subscription has been requested`
      )
    }
    this.remainingShapes = this.shapesRequested
    this.shapesRequested = undefined
  }

  subscriptionDataBegin({ subscriptionId }: SatSubsDataBegin) {
    if (!this.remainingShapes) {
      this.reset()
      throw new SatelliteError(
        SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
        `Received SatSubsDataBegin but no subscription is being delivered`
      )
    }

    if (this.currentSubscriptionId) {
      this.reset()
      throw new SatelliteError(
        SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
        `received SatSubsDataStart for subscription ${subscriptionId} but a subscription is already being delivered`
      )
    }
    this.currentSubscriptionId = subscriptionId

    this.inDelivery = {
      subscriptionId: subscriptionId,
      transactions: new Array(),
      shapeReqToUuid: {},
    }
  }

  subscriptionDataEnd(): SubscriptionData {
    if (!this.currentSubscriptionId || this.inDelivery == undefined) {
      this.reset()
      throw new SatelliteError(
        SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
        `Received SatSubDataEnd but no subscription is being delivered`
      )
    }

    if (this.remainingShapes != 0 || this.currentShapeUuid) {
      this.reset()
      throw new SatelliteError(
        SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
        `Received SatSubDataEnd but not all shapes have been delivered`
      )
    }

    this.currentSubscriptionId = undefined
    const res = this.inDelivery
    this.inDelivery = undefined
    return res
  }

  shapeDataBegin(shape: SatShapeDataBegin) {
    if (!this.currentSubscriptionId || this.inDelivery == undefined) {
      this.reset()
      throw new SatelliteError(
        SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
        `Received SatShapeDataBegin but no subscription is being delivered`
      )
    }

    if (this.remainingShapes == 0) {
      this.reset()
      throw new SatelliteError(
        SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
        `Received SatShapeDataBegin but all shapes have been delivered for this subscription`
      )
    }

    if (this.currentShapeUuid) {
      this.reset()
      throw new SatelliteError(
        SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
        `Received SatShapeDataBegin for shape with uuid ${shape.uuid} but a shape is already being delivered`
      )
    }

    if (this.inDelivery.shapeReqToUuid[shape.requestId]) {
      this.reset()
      throw new SatelliteError(
        SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
        `Received SatShapeDataBegin for shape with uuid ${shape.uuid} but shape has already been delivered`
      )
    }

    this.inDelivery.shapeReqToUuid[shape.requestId] = shape.uuid
    this.currentShapeUuid = shape.uuid
  }

  shapeDataEnd() {
    if (
      !this.remainingShapes ||
      !this.currentSubscriptionId ||
      this.inDelivery == undefined
    ) {
      this.reset()
      throw new SatelliteError(
        SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
        `Received SatShapeDataBegin but no subscription is being delivered`
      )
    }

    if (!this.currentShapeUuid) {
      this.reset()
      throw new SatelliteError(
        SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
        `Received SatShapeDataEnd but no shape is being delivered`
      )
    }

    this.currentShapeUuid = undefined
    this.remainingShapes--
  }

  transaction(transaction: SatOpLog) {
    if (
      !this.remainingShapes ||
      !this.currentSubscriptionId ||
      this.inDelivery == undefined ||
      !this.currentShapeUuid
    ) {
      this.reset()
      throw new SatelliteError(
        SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
        `Received SatOpLog but no shape is being delivered`
      )
    }
    this.inDelivery.transactions.push(transaction)
  }

  reset() {
    this.remainingShapes = undefined
    this.currentSubscriptionId = undefined
    this.currentShapeUuid = undefined
    this.inDelivery = undefined
  }
}
