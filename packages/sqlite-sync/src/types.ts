import {
  ChangeMessage,
  Row,
  ShapeStreamInterface,
  ShapeStreamOptions,
} from '@electric-sql/client'
import { SqliteWrapper } from './wrapper'
import { makeElectricSync } from './sync'

export type SyncNamespaceObj = Awaited<
  ReturnType<typeof makeElectricSync>
>[`electric`]

export type ElectricSync = SqliteWrapper & {
  electric: SyncNamespaceObj
  mutex: {
    acquire: () => Promise<void>
    release: () => void
    runExclusive: (fn: (db: SqliteWrapper) => Promise<void>) => Promise<void>
  }
}

export type CommitGranularity =
  | `up-to-date`
  // | 'transaction'  // Removed until Electric has stabilised on LSN metadata
  | `operation`
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
export type MapColumnsFn = (
  message: ChangeMessage<Row>
) => Record<string, unknown>
export type MapColumns = MapColumnsMap | MapColumnsFn
export type ShapeKey = string

export interface ElectricSyncOptions {
  debug?: boolean
  metadataSchema?: string
}
