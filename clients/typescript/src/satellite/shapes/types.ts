import { SatSubsDataBegin } from '../../_generated/protocol/satellite'
import { DataChange, SatelliteError } from '../../util'

export const SUBSCRIPTION_DELIVERED = 'subscription_delivered'
export const SUBSCRIPTION_ERROR = 'subscription_error'

export type SubscriptionId = string
export type TableName = string
export type ColumnName = string

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

export type Shape = {
  tablename: TableName
  include?: Array<Rel>
  where?: string
}

export type Rel = {
  foreignKey: Array<ColumnName> // allows composite FKs
  select: Shape
}

export type ShapeRequest = {
  requestId: string
  definition: Shape
}
export type ShapeDefinition = {
  uuid: string
  definition: Shape
}
export type ShapeRequestOrDefinition = ShapeRequest | ShapeDefinition

export type SubscriptionData = {
  subscriptionId: SubscriptionId
  lsn: SatSubsDataBegin['lsn']
  data: InitialDataChange[]
  shapeReqToUuid: { [req: string]: string }
}

export type InitialDataChange = Required<Omit<DataChange, 'type' | 'oldRecord'>>
