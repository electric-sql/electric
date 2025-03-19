import {
  ChangeMessage,
  Row,
  ShapeStreamInterface,
  ShapeStreamOptions,
} from '@electric-sql/client'
import { SqliteWrapper } from './wrapper'
import { makeElectricSync } from './sync'

export type SerializedLsn = string
export type Lsn = bigint

export type MapColumnsMap = Record<string, string>
export type MapColumnsFn = (message: ChangeMessage<any>) => Record<string, any>
export type MapColumns = MapColumnsMap | MapColumnsFn
export type SubscriptionKey = string

export type Transaction = SqliteWrapper | SqliteWrapper['transaction']

export interface ShapeToTableOptions {
  shape: ShapeStreamOptions
  table: string
  schema?: string
  mapColumns?: MapColumns
  primaryKey: string[]
  onMustRefetch?: (tx: Transaction) => Promise<void>
}

export interface SyncShapesToTablesOptions {
  key: string | null
  shapes: Record<string, ShapeToTableOptions>
  useCopy?: boolean
  onInitialSync?: () => void
}

export interface SyncShapesToTablesResult {
  unsubscribe: () => void
  readonly isUpToDate: boolean
  streams: Record<string, ShapeStreamInterface<Row<unknown>>>
}

export interface SyncShapeToTableOptions {
  shape: ShapeStreamOptions
  table: string
  schema?: string
  mapColumns?: MapColumns
  primaryKey: string[]
  shapeKey: string | null
  useCopy?: boolean
  onInitialSync?: () => void
  onMustRefetch?: (tx: Transaction) => Promise<void>
}

export interface SyncShapeToTableResult {
  unsubscribe: () => void
  readonly isUpToDate: boolean
  stream: ShapeStreamInterface<Row<unknown>>
}

export interface ElectricSyncOptions {
  debug?: boolean
  metadataSchema?: string
}

export type InsertChangeMessage = ChangeMessage<any> & {
  headers: { operation: 'insert' }
}

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