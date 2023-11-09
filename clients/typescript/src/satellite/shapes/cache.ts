import EventEmitter from 'events'
import {
  SatShapeDataBegin,
  SatSubsDataBegin,
  SatSubsDataError,
  SatSubsReq,
  SatSubsResp,
  SatTransOp,
} from '../../_generated/protocol/satellite.js'
import {
  Relation,
  SatelliteError,
  SatelliteErrorCode,
  subsDataErrorToSatelliteError,
} from '../../util/index.js'
import { deserializeRow } from '../client.js'
import {
  InitialDataChange,
  SUBSCRIPTION_DELIVERED,
  SUBSCRIPTION_ERROR,
  SubscriptionData,
} from './types.js'
import { DbSchema } from '../../client/model/schema.js'

type SubscriptionId = string
type RequestId = string

type SubscriptionDataInternal = {
  subscriptionId: SubscriptionId
  lsn: SatSubsDataBegin['lsn']
  transaction: SatTransOp[]
  shapeReqToUuid: Record<string, string>
}

export class SubscriptionsDataCache extends EventEmitter {
  requestedSubscriptions: Record<SubscriptionId, Set<RequestId>>
  remainingShapes: Set<RequestId>
  currentShapeRequestId?: RequestId
  inDelivery?: SubscriptionDataInternal
  dbDescription: DbSchema<any>

  constructor(dbDescription: DbSchema<any>) {
    super()

    this.requestedSubscriptions = {}
    this.remainingShapes = new Set()
    this.dbDescription = dbDescription
  }

  isDelivering(): boolean {
    return this.inDelivery != undefined
  }

  subscriptionRequest(subsRequest: SatSubsReq) {
    const { subscriptionId, shapeRequests } = subsRequest
    const requestedShapes = new Set(
      shapeRequests.map((shape) => shape.requestId)
    )
    this.requestedSubscriptions[subscriptionId] = requestedShapes
  }

  subscriptionResponse({ subscriptionId }: SatSubsResp) {
    if (!this.requestedSubscriptions[subscriptionId]) {
      this.internalError(
        SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
        `Received subscribe response for unknown subscription ${subscriptionId}`,
        subscriptionId
      )
    }
  }

  subscriptionDataBegin({ subscriptionId, lsn }: SatSubsDataBegin) {
    if (!this.requestedSubscriptions[subscriptionId]) {
      this.internalError(
        SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
        `Received SatSubsDataBegin but for unknown subscription ${subscriptionId}`,
        subscriptionId
      )
    }

    if (this.inDelivery) {
      this.internalError(
        SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
        `received SatSubsDataStart for subscription ${subscriptionId} but a subscription (${this.inDelivery.subscriptionId}) is already being delivered`,
        subscriptionId
      )
    }

    this.remainingShapes = this.requestedSubscriptions[subscriptionId]
    this.inDelivery = {
      subscriptionId,
      lsn,
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
      lsn: delivered.lsn,
      data: delivered.transaction.map((t) =>
        this.proccessShapeDataOperations(t, relations)
      ),
      shapeReqToUuid: delivered.shapeReqToUuid,
    }

    this.reset(subscriptionData.subscriptionId)
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

  internalError(
    code: SatelliteErrorCode,
    msg: string,
    subId: SubscriptionId | undefined = this.inDelivery?.subscriptionId
  ): never {
    this.reset(subId)
    const error = new SatelliteError(code, msg)
    this.emit(SUBSCRIPTION_ERROR, error)

    throw error
  }

  // It is safe to reset the cache state without throwing.
  // However, if message is unexpected, we emit the error
  subscriptionError(subId: SubscriptionId): void {
    if (!this.requestedSubscriptions[subId]) {
      this.internalError(
        SatelliteErrorCode.SUBSCRIPTION_NOT_FOUND,
        `received subscription error for unknown subscription ${subId}`,
        subId
      )
    }

    this.reset(subId)
  }

  subscriptionDataError(subId: SubscriptionId, msg: SatSubsDataError): never {
    let error = subsDataErrorToSatelliteError(msg)
    if (!this.inDelivery) {
      error = new SatelliteError(
        SatelliteErrorCode.UNEXPECTED_SUBSCRIPTION_STATE,
        `received subscription data error, but no subscription is being delivered: ${error.message}`
      )
    }

    this.reset(subId)

    this.emit(SUBSCRIPTION_ERROR, msg.subscriptionId, error)
    throw error
  }

  reset(subscriptionId?: string) {
    if (subscriptionId) delete this.requestedSubscriptions[subscriptionId]
    if (subscriptionId === this.inDelivery?.subscriptionId) {
      // Only reset the delivery information
      // if the reset is meant for the subscription
      // that is currently being delivered.
      // This ensures we do not reset delivery information
      // if there is an error for another subscription
      // that is not the one being delivered.
      this.remainingShapes = new Set()
      this.currentShapeRequestId = undefined
      this.inDelivery = undefined
    }
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

    const record = deserializeRow(rowData, relation, this.dbDescription)

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
