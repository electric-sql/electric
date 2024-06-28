import { ShapeSubscription } from '../../satellite'
import { Shape } from '../../satellite/shapes/types'

export type TableName = string

export type SyncStatus =
  | undefined
  | { status: 'active'; serverId: string }
  | { status: 'cancelling'; serverId: string }
  | {
      status: 'establishing'
      serverId: string
      progress: 'receiving_data' | 'removing_data'
      oldServerId?: string
    }

export interface IShapeManager {
  subscribe(shapes: Shape[], key?: string): Promise<ShapeSubscription>
  unsubscribe(keys: string[]): Promise<void>
  syncStatus(key: string): SyncStatus
}
