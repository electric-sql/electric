import { SatSubsDataBegin } from '../../_generated/protocol/satellite.js'
import { DataChange, SatelliteError } from '../../util/index.js'

export const SUBSCRIPTION_DELIVERED = 'subscription_delivered'
export const SUBSCRIPTION_ERROR = 'subscription_error'

export type SubscriptionId = string

export type SubscriptionDeliveredCallback = (data: SubscriptionData) => void
export type SubscriptionErrorCallback = (
  error: SatelliteError,
  subscriptionId?: SubscriptionId
) => void

export type SubscribeResponse = {
  subscriptionId: SubscriptionId
  error?: SatelliteError
}

export type UnsubscribeResponse = Record<string, never>

export type ClientShapeDefinition = {
  selects: ShapeSelect[]
}

export type ShapeRequest = {
  requestId: string
  definition: ClientShapeDefinition
}
export type ShapeDefinition = {
  uuid: string
  definition: ClientShapeDefinition
}
export type ShapeRequestOrDefinition = ShapeRequest | ShapeDefinition

export type ShapeSelect = {
  tablename: string
}

export type SubscriptionData = {
  subscriptionId: SubscriptionId
  lsn: SatSubsDataBegin['lsn']
  data: InitialDataChange[]
  shapeReqToUuid: { [req: string]: string }
}

export type InitialDataChange = Required<Omit<DataChange, 'type' | 'oldRecord'>>
