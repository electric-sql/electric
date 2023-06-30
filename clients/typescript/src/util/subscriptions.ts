import { Relation, SatelliteError, SatelliteErrorCode } from './types'

import {
  SatSubsDataBegin,
  SatShapeDataBegin,
  SatTransOp,
  SatSubsResp,
} from '../_generated/protocol/satellite'
import EventEmitter from 'events'
import { deserializeRow } from '../satellite/client'
import {
  InitialDataChange,
  SUBSCRIPTION_DELIVERED,
  SUBSCRIPTION_ERROR,
  ShapeDefinition,
  ShapeRequest,
  ShapeRequestOrDefinition,
  SubscriptionData,
} from '../satellite/shapes/types'

type SubcriptionShapeDefinitions = Record<string, ShapeDefinition[]>

type SubcriptionShapeRequests = Record<string, ShapeRequest[]>

type SubscriptionDataInternal = {
  subscriptionId: string
  transaction: SatTransOp[]
  shapeReqToUuid: Record<string, string>
}

export type GarbageCollectShapeHandler = (
  shapeDef: ShapeDefinition
) => Promise<void>

export interface SubscriptionsManager {
  subscriptionRequested(subId: string, shapeRequests: ShapeRequest[]): void

  subscriptionDelivered(data: SubscriptionData): void

  shapesForActiveSubscription(subId: string): ShapeDefinition[] | undefined

  unsubscribe(subId: string): void

  unsubscribeAll(): void

  serialize(): string
}

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

export class SubscriptionsDataCache extends EventEmitter {
  requestedSubscription?: string
  remainingShapes: Set<string>
  currentShapeRequestId?: string
  inDelivery?: SubscriptionDataInternal

  constructor() {
    super()

    this.requestedSubscription = undefined
    this.remainingShapes = new Set()
  }
  isDelivering(): boolean {
    return this.inDelivery != undefined
  }

  subscriptionRequest(shapeRequestIds: string[]) {
    if (this.remainingShapes.size != 0) {
      this.subscriptionError(
        SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
        `received subscription request but a subscription is already being delivered`
      )
    }
    shapeRequestIds.forEach((rid) => this.remainingShapes.add(rid))
  }

  subscriptionResponse({ subscriptionId }: SatSubsResp) {
    if (this.remainingShapes.size == 0) {
      this.subscriptionError(
        SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
        `Received subscribe response but no subscription has been requested`
      )
    }
    this.requestedSubscription = subscriptionId
  }

  subscriptionDataBegin({ subscriptionId }: SatSubsDataBegin) {
    if (!this.requestedSubscription) {
      this.subscriptionError(
        SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
        `Received SatSubsDataBegin but no subscription is being delivered`
      )
    }

    if (this.requestedSubscription != subscriptionId) {
      this.subscriptionError(
        SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
        `subscription identifier in SatSubsDataBegin does not match the expected`
      )
    }

    if (this.inDelivery) {
      this.subscriptionError(
        SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
        `received SatSubsDataStart for subscription ${subscriptionId} but a subscription is already being delivered`
      )
    }

    this.inDelivery = {
      subscriptionId: subscriptionId,
      transaction: [],
      shapeReqToUuid: {},
    }
  }

  subscriptionDataEnd(
    relations: Map<number, Relation>
  ): SubscriptionDataInternal {
    if (!this.inDelivery) {
      this.subscriptionError(
        SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
        `Received SatSubDataEnd but no subscription is being delivered`
      )
    }

    if (this.remainingShapes.size > 0) {
      this.subscriptionError(
        SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
        `Received SatSubDataEnd but not all shapes have been delivered`
      )
    }

    const delivered = this.inDelivery
    const subscriptionData: SubscriptionData = {
      subscriptionId: delivered.subscriptionId,
      data: delivered.transaction.map((t) =>
        this.proccessShapeDataOperations(t, relations)
      ),
      shapeReqToUuid: delivered.shapeReqToUuid,
    }

    this.reset()
    this.emit(SUBSCRIPTION_DELIVERED, subscriptionData)
    return delivered
  }

  shapeDataBegin(shape: SatShapeDataBegin) {
    if (!this.inDelivery) {
      this.subscriptionError(
        SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
        `Received SatShapeDataBegin but no subscription is being delivered`
      )
    }

    if (this.remainingShapes.size == 0) {
      this.subscriptionError(
        SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
        `Received SatShapeDataBegin but all shapes have been delivered for this subscription`
      )
    }

    if (this.currentShapeRequestId) {
      this.subscriptionError(
        SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
        `Received SatShapeDataBegin for shape with uuid ${shape.uuid} but a shape is already being delivered`
      )
    }

    if (this.inDelivery.shapeReqToUuid[shape.requestId]) {
      this.subscriptionError(
        SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
        `Received SatShapeDataBegin for shape with uuid ${shape.uuid} but shape has already been delivered`
      )
    }

    this.inDelivery.shapeReqToUuid[shape.requestId] = shape.uuid
    this.currentShapeRequestId = shape.requestId
  }

  shapeDataEnd() {
    if (!this.inDelivery) {
      this.subscriptionError(
        SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
        `Received SatShapeDataEnd but no subscription is being delivered`
      )
    }

    if (!this.currentShapeRequestId) {
      this.subscriptionError(
        SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
        `Received SatShapeDataEnd but no shape is being delivered`
      )
    }

    this.remainingShapes.delete(this.currentShapeRequestId)
    this.currentShapeRequestId = undefined
  }

  transaction(ops: SatTransOp[]) {
    if (
      this.remainingShapes.size == 0 ||
      !this.inDelivery ||
      !this.currentShapeRequestId
    ) {
      this.subscriptionError(
        SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
        `Received SatOpLog but no shape is being delivered`
      )
    }
    for (const op of ops) {
      if (op.begin || op.commit || op.update || op.delete) {
        this.subscriptionError(
          SatelliteErrorCode.UNEXPECTED_MESSAGE_TYPE,
          `Received begin, commit, update or delete message, but these messages are not valid in subscriptions`
        )
      }

      this.inDelivery.transaction.push(op)
    }
  }

  subscriptionError(code: SatelliteErrorCode, msg: string): never {
    this.reset()
    const error = new SatelliteError(code, msg)
    this.emit(SUBSCRIPTION_ERROR, error)

    throw error
  }

  reset() {
    this.requestedSubscription = undefined
    this.remainingShapes = new Set()
    this.currentShapeRequestId = undefined
    this.inDelivery = undefined
  }

  private proccessShapeDataOperations(
    op: SatTransOp,
    relations: Map<number, Relation>
  ): InitialDataChange {
    if (!op.insert) {
      this.subscriptionError(
        SatelliteErrorCode.UNEXPECTED_MESSAGE_TYPE,
        'invalid shape data operation'
      )
    }

    const { relationId, rowData, tags } = op.insert

    const relation = relations.get(relationId)
    if (!relation) {
      this.subscriptionError(
        SatelliteErrorCode.PROTOCOL_VIOLATION,
        `missing relation ${relationId} for incoming operation`
      )
    }

    const record = deserializeRow(rowData, relation)

    if (!record) {
      this.subscriptionError(
        SatelliteErrorCode.PROTOCOL_VIOLATION,
        'INSERT operations has no data'
      )
    }

    return {
      relation,
      record,
      tags,
    }
  }
}
