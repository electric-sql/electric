import { ShapeSubscription } from '../../satellite'
import { Shape } from '../../satellite/shapes/types'

export type TableName = string

export type SyncStatus =
  | {
      status: 'exchanging'
      oldServerId: string | undefined
      newServerId: string | undefined
    }
  | {
      status: 'requested'
      serverId: string
    }
  | {
      status: 'finishing_exchange'
      serverId: string
    }
  | {
      status: 'active'
      serverId: string
    }
  | undefined

export interface IShapeManager {
  subscribe(shapes: Shape[], key?: string): Promise<ShapeSubscription>
  unsubscribe(keys: string[]): Promise<void>
  syncStatus(key: string): SyncStatus
}

