import EventEmitter from 'events'
import {
  SatShapeDataBegin,
  SatSubsDataBegin,
  SatSubsError,
  SatSubsResp,
  SatTransOp,
} from '../../_generated/protocol/satellite'
import {
  Relation,
  SatelliteError,
  SatelliteErrorCode,
  subscriptionErrorToSatelliteError,
} from '../../util'
import { deserializeRow } from '../client'
import {
  InitialDataChange,
  SUBSCRIPTION_DELIVERED,
  SUBSCRIPTION_ERROR,
  SubscriptionData,
} from './types'

type SubscriptionDataInternal = {
  subscriptionId: string
  transaction: SatTransOp[]
  shapeReqToUuid: Record<string, string>
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
      this.internalError(
        SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
        `received subscription request but a subscription is already being delivered`
      )
    }
    shapeRequestIds.forEach((rid) => this.remainingShapes.add(rid))
  }

  subscriptionResponse({ subscriptionId }: SatSubsResp) {
    if (this.remainingShapes.size == 0) {
      this.internalError(
        SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
        `Received subscribe response but no subscription has been requested`
      )
    }
    this.requestedSubscription = subscriptionId
  }

  subscriptionDataBegin({ subscriptionId }: SatSubsDataBegin) {
    if (!this.requestedSubscription) {
      this.internalError(
        SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
        `Received SatSubsDataBegin but no subscription is being delivered`
      )
    }

    if (this.requestedSubscription != subscriptionId) {
      this.internalError(
        SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
        `subscription identifier in SatSubsDataBegin does not match the expected`
      )
    }

    if (this.inDelivery) {
      this.internalError(
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
      this.internalError(
        SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
        `Received SatSubDataEnd but no subscription is being delivered`
      )
    }

    if (this.remainingShapes.size > 0) {
      this.internalError(
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
      this.internalError(
        SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
        `Received SatShapeDataBegin but no subscription is being delivered`
      )
    }

    if (this.remainingShapes.size == 0) {
      this.internalError(
        SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
        `Received SatShapeDataBegin but all shapes have been delivered for this subscription`
      )
    }

    if (this.currentShapeRequestId) {
      this.internalError(
        SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
        `Received SatShapeDataBegin for shape with uuid ${shape.uuid} but a shape is already being delivered`
      )
    }

    if (this.inDelivery.shapeReqToUuid[shape.requestId]) {
      this.internalError(
        SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
        `Received SatShapeDataBegin for shape with uuid ${shape.uuid} but shape has already been delivered`
      )
    }

    this.inDelivery.shapeReqToUuid[shape.requestId] = shape.uuid
    this.currentShapeRequestId = shape.requestId
  }

  shapeDataEnd() {
    if (!this.inDelivery) {
      this.internalError(
        SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
        `Received SatShapeDataEnd but no subscription is being delivered`
      )
    }

    if (!this.currentShapeRequestId) {
      this.internalError(
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
      this.internalError(
        SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
        `Received SatOpLog but no shape is being delivered`
      )
    }
    for (const op of ops) {
      if (op.begin || op.commit || op.update || op.delete) {
        this.internalError(
          SatelliteErrorCode.UNEXPECTED_MESSAGE_TYPE,
          `Received begin, commit, update or delete message, but these messages are not valid in subscriptions`
        )
      }

      this.inDelivery.transaction.push(op)
    }
  }

  internalError(code: SatelliteErrorCode, msg: string): never {
    this.reset()
    const error = new SatelliteError(code, msg)
    this.emit(SUBSCRIPTION_ERROR, error)

    throw error
  }

  subscriptionError(msg: SatSubsError): never {
    this.reset()
    const error = subscriptionErrorToSatelliteError(msg)
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
      this.internalError(
        SatelliteErrorCode.UNEXPECTED_MESSAGE_TYPE,
        'invalid shape data operation'
      )
    }

    const { relationId, rowData, tags } = op.insert

    const relation = relations.get(relationId)
    if (!relation) {
      this.internalError(
        SatelliteErrorCode.PROTOCOL_VIOLATION,
        `missing relation ${relationId} for incoming operation`
      )
    }

    const record = deserializeRow(rowData, relation)

    if (!record) {
      this.internalError(
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
