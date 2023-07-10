import { DataChange, SatelliteError } from '../../util'

export const SUBSCRIPTION_DELIVERED = 'subscription_delivered'
export const SUBSCRIPTION_ERROR = 'subscription_error'

export type SubscriptionDeliveredCallback = (data: SubscriptionData) => void
export type SubscriptionErrorCallback = (
  error: SatelliteError,
  subscriptionId?: string
) => void

export type SubscribeResponse = {
  subscriptionId: string
  error?: SatelliteError
}

export type UnsubscribeResponse = Record<string, never>

export type ClientShapeDefinition = {
  selects: ShapeSelect[]
}

export type ShapeRequestOrDefinition = {
  uuid?: string
  requestId?: string
  definition: ClientShapeDefinition
}

export type ShapeRequest = Required<Omit<ShapeRequestOrDefinition, 'uuid'>>
export type ShapeDefinition = Required<
  Omit<ShapeRequestOrDefinition, 'requestId'>
>

export type ShapeSelect = {
  tablename: string
}

export type SubscriptionData = {
  subscriptionId: string
  data: InitialDataChange[]
  shapeReqToUuid: { [req: string]: string }
}

export type InitialDataChange = Required<Omit<DataChange, 'type' | 'oldRecord'>>
