import {
  ChangeMessage,
  ShapeStreamInterface,
  ShapeStreamOptions,
} from '@electric-sql/client'

export type ElectricSync = {
  syncShapeToTable: (
    options: SyncShapeToTableOptions
  ) => Promise<SyncShapeToTableResult>
}

export type CommitGranularity =
  | 'up-to-date'
  // | 'transaction'  // Removed until Electric has stabilised on LSN metadata
  | 'operation'
  | number

export interface SyncShapeToTableOptions {
  shape: ShapeStreamOptions
  table: string
  schema?: string
  mapColumns?: MapColumns
  primaryKey: string[]
  shapeKey: ShapeKey | null
  useCopy?: boolean
  commitGranularity?: CommitGranularity
  commitThrottle?: number
  onInitialSync?: () => void
}

export interface SyncShapeToTableResult {
  unsubscribe: () => void
  readonly isUpToDate: boolean
  readonly shapeId: string
  subscribe: (cb: () => void, error: (err: Error) => void) => () => void
  stream: ShapeStreamInterface
}

export type MapColumnsMap = Record<string, string>
export type MapColumnsFn = (message: ChangeMessage<any>) => Record<string, any>
export type MapColumns = MapColumnsMap | MapColumnsFn
export type ShapeKey = string

export interface ElectricSyncOptions {
  debug?: boolean
  metadataSchema?: string
}
