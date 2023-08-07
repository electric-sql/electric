import type Long from 'long'
import {
  SatOpMigrate_Column,
  SatOpMigrate_Table,
  SatOpMigrate_Type,
  SatRelation_RelationType,
} from '../_generated/protocol/satellite'
import { Tag } from '../satellite/oplog'

export type AnyFunction = (...args: any[]) => any
export type BindParams = SqlValue[] | Row
export type DbName = string
export type DbNamespace = string
export type EmptyFunction = () => void
export type FunctionMap = { [key: string]: AnyFunction }
export type Path = string
export type Query = string
export type Row = { [key: string]: SqlValue }
export type RowCallback = (row: Row) => void
export type RowId = number
export type SqlValue = string | number | null | Uint8Array | bigint
export type StatementId = string
export type Tablename = string
export type VoidOrPromise = void | Promise<void>
export type LSN = Uint8Array
export type Statement = { sql: string; args?: BindParams }

export class SatelliteError extends Error {
  public code: SatelliteErrorCode

  constructor(code: SatelliteErrorCode, message?: string) {
    super(message)
    this.code = code
  }
}

export enum SatelliteErrorCode {
  CONNECTION_FAILED,
  INTERNAL,
  TIMEOUT,
  REPLICATION_NOT_STARTED,
  REPLICATION_ALREADY_STARTED,
  UNEXPECTED_STATE,
  UNEXPECTED_MESSAGE_TYPE,
  PROTOCOL_VIOLATION,
  UNKNOWN_DATA_TYPE,
  AUTH_ERROR,

  SUBSCRIPTION_ALREADY_EXISTS,
  UNEXPECTED_SUBSCRIPTION_STATE,

  // start replication errors
  BEHIND_WINDOW,
  INVALID_POSITION,
  SUBSCRIPTION_NOT_FOUND,
  SUBSCRIPTION_ERROR,
  MALFORMED_LSN,
  UNKNOWN_SCHEMA_VSN,

  // subscription errors
  SHAPE_REQUEST_ERROR,
  SUBSCRIPTION_ID_ALREADY_EXISTS,

  // shape request errors
  TABLE_NOT_FOUND,
  REFERENTIAL_INTEGRITY_VIOLATION,
  EMPTY_SHAPE_DEFINITION,
  DUPLICATE_TABLE_IN_SHAPE_DEFINITION,

  // shape data errors
  SHAPE_DELIVERY_ERROR,
  SHAPE_SIZE_LIMIT_EXCEEDED,
}

export type AuthResponse = {
  serverId?: string
  error?: Error
}

export type Transaction = {
  commit_timestamp: Long
  lsn: LSN
  changes: Change[]
  // This field is only set by transactions coming from Electric
  origin?: string
  migrationVersion?: string // the Postgres version number if this is a migration
}

// A transaction whose changes are only DML statements
// i.e. the transaction does not contain migrations
export type DataTransaction = Omit<
  Transaction,
  'changes' | 'migrationVersion'
> & {
  changes: DataChange[]
}

export enum DataChangeType {
  INSERT = 'INSERT',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
}

export type Change = DataChange | SchemaChange

export type DataChange = {
  relation: Relation
  type: DataChangeType
  record?: Record
  oldRecord?: Record
  tags: Tag[]
}

// The properties are omitted from columns because they are not currently used.
export type MigrationTable = Omit<SatOpMigrate_Table, '$type' | 'columns'> & {
  columns: Omit<SatOpMigrate_Column, '$type' | 'sqliteType' | 'pgType'>[]
}

export type SchemaChange = {
  table: MigrationTable // table affected by the schema change
  migrationType: SatOpMigrate_Type
  sql: string
}

// Some functions for narrowing `Change` and `Transaction` types
export function isDataChange(change: Change): change is DataChange {
  return 'relation' in change
}

export type Record = { [key: string]: string | number | undefined | null }

export type Replication = {
  authenticated: boolean
  isReplicating: ReplicationStatus
  relations: Map<number, Relation>
  ack_lsn?: LSN
  enqueued_lsn?: LSN
  transactions: Transaction[]
}

export type OutgoingReplication = Omit<Replication, 'transactions'> & {
  transactions: DataTransaction[] // outgoing transactions cannot contain migrations
}

export type Relation = {
  id: number
  schema: string
  table: string
  tableType: SatRelation_RelationType
  columns: RelationColumn[]
}

export type RelationColumn = {
  name: string
  type: string
  isNullable: boolean
  primaryKey?: boolean
}

export type RelationsCache = { [k: string]: Relation }

export enum ReplicationStatus {
  STOPPED,
  STARTING,
  STOPPING,
  ACTIVE,
  SERVER_ERROR,
}

export enum AckType {
  LOCAL_SEND,
  REMOTE_COMMIT,
}

export type AckCallback = (lsn: LSN, type: AckType) => void

export type ConnectivityState =
  | 'available'
  | 'connected'
  | 'disconnected'
  | 'error'
