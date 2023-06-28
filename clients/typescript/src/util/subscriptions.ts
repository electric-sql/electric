import {
  DataChange,
  DataChangeType,
  Relation,
  RelationsCache,
  SatelliteError,
  SatelliteErrorCode,
  ShapeDefinition,
  ShapeRequest,
  ShapeRequestOrDefinition,
  SubscriptionData,
} from './types'

import {
  SatSubsDataBegin,
  SatShapeDataBegin,
  SatTransOp,
  SatSubsError,
  SatSubsResp,
} from '../_generated/protocol/satellite'
import EventEmitter from 'events'
import { deserializeRow } from '../satellite/client'

type SubcriptionShapeDefinitions = {
  [k: string]: ShapeDefinition[]
}

type SubcriptionShapeRequests = {
  [k: string]: ShapeRequest[]
}

type SubscriptionDataInternal = {
  subscriptionId: string
  transaction: SatTransOp[]
  shapeReqToUuid: { [req: string]: string }
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

  subscribeToUnsubscribeEvent(callback: GarbageCollectShapeHandler): void
  unsubscribeToUnsubscribeEvent(callback: GarbageCollectShapeHandler): void
}

export class InMemorySubscriptionsManager
  extends EventEmitter
  implements SubscriptionsManager
{
  private inFlight: SubcriptionShapeRequests
  private subToShapes: SubcriptionShapeDefinitions

  constructor() {
    super()

    this.inFlight = {}
    this.subToShapes = {}
  }

  subscribeToUnsubscribeEvent(callback: GarbageCollectShapeHandler) {
    this.on('unsubscribe', callback)
  }

  unsubscribeToUnsubscribeEvent(callback: GarbageCollectShapeHandler) {
    this.removeListener('unsubscribe', callback)
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

  subscriptionDelivered(data: SubscriptionData) {
    const { subscriptionId, shapeReqToUuid } = data
    if (!this.inFlight[subscriptionId]) {
      // unknown, or already unsubscribed. delivery is noop
      return
    }

    const inflight = this.inFlight[subscriptionId]
    delete this.inFlight[subscriptionId]
    for (const shapeReq of inflight) {
      const shapeRequestOrResolved = shapeReq as ShapeRequestOrDefinition

      if (shapeReqToUuid[shapeReq.requestId]) {
        if (!this.subToShapes[subscriptionId]) {
          this.subToShapes[subscriptionId] = new Array()
        }

        // would like to understand how to do this properly
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

  unsubscribe(subId: string) {
    const subscription = this.shapesForActiveSubscription(subId)
    if (subscription) {
      subscription.forEach((s: ShapeDefinition) => this.emit('unsubscribe', s))
    }
    delete this.inFlight[subId]
    delete this.subToShapes[subId]
  }

  unsubscribeAll(): void {
    for (const subId in this.subToShapes) {
      this.unsubscribe(subId)
    }
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

// server sends tags, but no timestamp. Is this correct?
// initial connect sends pending oplog, clears it (wait for server ack) and then can start making subscriptions.
// ensure database is up-with-schema before receiving shape, otherwise need to send relation alongside and handle that.
// client would process migrations if they are sent before subscription begin

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
      this.reset()
      this.subscriptionError(
        SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
        `received subscription request but a subscription is already being delivered`
      )
    }
    shapeRequestIds.forEach((rid) => this.remainingShapes.add(rid))
  }

  subscriptionResponse({ subscriptionId }: SatSubsResp) {
    if (this.remainingShapes.size == 0) {
      this.reset()
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
      transaction: new Array(),
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
    const res = this.inDelivery

    const subscriptionData: SubscriptionData = {
      subscriptionId: res.subscriptionId,
      data: {
        changes: res.transaction.map((t) =>
          this.proccessShapeDataOperations(t, relations)
        ),
      },
      shapeReqToUuid: res.shapeReqToUuid,
    }

    this.requestedSubscription = undefined
    this.remainingShapes = new Set()
    this.inDelivery = undefined

    this.emit('subscription_delivered', subscriptionData)
    return res
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
      // leaving this code here until merge in case we want to add txn delimiters
      // if (op.begin && this.inDelivery.transaction.length != 0) {
      //  this.subscriptionError(
      //     SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
      //     `Received begin, but some operation has been delivered already`
      //   )
      // }

      // if (!op.begin && this.inDelivery.transaction.length == 0) {
      //
      //   this.subscriptionError(
      //     SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
      //     `Received some operation before receiving begin`
      //   )
      // }

      // if (
      //   this.inDelivery.transaction.length > 0 &&
      //   this.inDelivery.transaction.at(-1)!.commit
      // ) {
      //
      //   this.subscriptionError(
      //     SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
      //     `Received some message after commit`
      //   )
      // }

      this.inDelivery.transaction.push(op)
    }
  }

  subscriptionError(code: SatelliteErrorCode, msg: string): never {
    this.reset()
    const error = new SatelliteError(code, msg)
    this.emit('subscription_error', error)

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
  ): DataChange {
    if (!op.insert) {
      this.subscriptionError(
        SatelliteErrorCode.UNEXPECTED_MESSAGE_TYPE,
        'invalid shape data operation'
      )
    }

    const rid = op.insert.relationId
    const rel = relations.get(rid)
    if (!rel) {
      this.subscriptionError(
        SatelliteErrorCode.PROTOCOL_VIOLATION,
        `missing relation ${op.insert.relationId} for incoming operation`
      )
    }

    const change = {
      relation: rel,
      type: DataChangeType.INSERT,
      record: deserializeRow(op.insert.rowData!, rel),
      tags: op.insert.tags,
    }

    return change
  }
}
