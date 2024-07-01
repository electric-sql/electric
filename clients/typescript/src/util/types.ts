import type Long from 'long'
import {
  SatOpMigrate_Column,
  SatOpMigrate_PgColumnType,
  SatOpMigrate_Table,
  SatOpMigrate_Type,
  SatRelation_RelationType,
} from '../_generated/protocol/satellite'
import { Tag } from '../satellite/oplog'
import type { Row, SqlValue } from '@electric-sql/drivers/util'

export type {
  DbName,
  SqlValue,
  Row,
  BindParams,
  Statement,
} from '@electric-sql/drivers/util'

export type DbNamespace = string
export type Tablename = string
export type AnyFunction = (...args: any[]) => any
export type EmptyFunction = () => void
export type FunctionMap = { [key: string]: AnyFunction }
export type Path = string
export type Query = string
export type RowCallback = (row: Row) => void
export type RowId = number
export type StatementId = string
export type VoidOrPromise = void | Promise<void>
export type LSN = Uint8Array

export class SatelliteError extends Error {
  public code: SatelliteErrorCode

  constructor(code: SatelliteErrorCode, message?: string) {
    super(message)
    this.code = code
  }
}

export enum SatelliteErrorCode {
  CONNECTION_CANCELLED_BY_DISCONNECT,
  CONNECTION_FAILED_AFTER_RETRY,
  INTERNAL,
  TIMEOUT,
  REPLICATION_NOT_STARTED,
  REPLICATION_ALREADY_STARTED,
  UNEXPECTED_STATE,
  UNEXPECTED_MESSAGE_TYPE,
  PROTOCOL_VIOLATION,
  UNKNOWN_DATA_TYPE,
  SOCKET_ERROR,
  UNRECOGNIZED,
  FATAL_ERROR,

  // auth errors
  AUTH_ERROR,
  AUTH_FAILED,
  AUTH_REQUIRED,
  AUTH_EXPIRED,

  // server errors
  INVALID_REQUEST,
  PROTO_VSN_MISMATCH,
  REPLICATION_FAILED,

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
  SUBSCRIPTION_ALREADY_EXISTS,
  UNEXPECTED_SUBSCRIPTION_STATE,

  // shape request errors
  TABLE_NOT_FOUND,
  REFERENTIAL_INTEGRITY_VIOLATION,
  EMPTY_SHAPE_DEFINITION,
  DUPLICATE_TABLE_IN_SHAPE_DEFINITION,
  INVALID_WHERE_CLAUSE_IN_SHAPE_DEFINITION,
  INVALID_INCLUDE_TREE_IN_SHAPE_DEFINITION,

  // shape data errors
  SHAPE_DELIVERY_ERROR,
  SHAPE_SIZE_LIMIT_EXCEEDED,

  // replication transform errors
  REPLICATION_TRANSFORM_ERROR,
}

export type SocketCloseReason =
  | SatelliteErrorCode.AUTH_EXPIRED
  | SatelliteErrorCode.SOCKET_ERROR

export type AuthResponse = {
  serverId?: string
  error?: Error
}

export type StartReplicationResponse = {
  error?: SatelliteError
}

export type StopReplicationResponse = {
  error?: SatelliteError
}

export type Transaction = {
  commit_timestamp: Long
  lsn: LSN
  changes: Change[]
  // This field is only set by transactions coming from Electric
  origin?: string
  migrationVersion?: string // the Postgres version number if this is a migration
}

export type ServerTransaction = Transaction & {
  id: Long
  additionalDataRef?: Long
}

export interface AdditionalData {
  ref: Long
  changes: DataInsert[]
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
  COMPENSATION = 'COMPENSATION',
  GONE = 'GONE',
}

export type Change = DataChange | SchemaChange

export type DataChange = {
  relation: Relation
  type: DataChangeType
  record?: DbRecord
  oldRecord?: DbRecord
  tags: Tag[]
}

export type DataGone = {
  relation: Relation
  type: DataChangeType.GONE
  oldRecord: DbRecord
  tags: []
}

export type DataInsert = {
  relation: Relation
  type: DataChangeType.INSERT
  record: DbRecord
  tags: Tag[]
}

export type SatOpMigrate_Col = Omit<SatOpMigrate_Column, '$type' | 'pgType'> & {
  pgType: Omit<SatOpMigrate_PgColumnType, '$type'> | undefined
}

export type MigrationTable = Omit<SatOpMigrate_Table, '$type' | 'columns'> & {
  columns: SatOpMigrate_Col[]
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

export type DbRecord = {
  [key: string]: SqlValue
}

export type Replication<TransactionType> = {
  authenticated: boolean
  isReplicating: ReplicationStatus
  relations: Map<number, Relation>
  last_lsn: LSN | undefined
  transactions: TransactionType[]
}

export interface InboundReplication extends Replication<ServerTransaction> {
  lastTxId: Long | undefined
  lastAckedTxId: Long | undefined
  unackedTxs: number
  maxUnackedTxs: number
  ackTimer: ReturnType<typeof setTimeout>
  ackPeriod: number
  additionalData: AdditionalData[]
  unseenAdditionalDataRefs: Set<string>
  incomplete?: 'transaction' | 'additionalData'
  goneBatch: DataGone[]
  receivingUnsubsBatch: false | string[]
  seenAdditionalDataSinceLastTx: {
    subscriptions: string[]
    dataRefs: Long[]
    gone: string[]
  }
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
  primaryKey?: number
}

export type RelationsCache = { [k: string]: Relation }

export enum ReplicationStatus {
  STOPPED,
  STARTING,
  STOPPING,
  ACTIVE,
}

export type ReplicatedRowTransformer<RowType> = {
  transformInbound: (row: Readonly<RowType>) => RowType
  transformOutbound: (row: Readonly<RowType>) => RowType
}

export type ErrorCallback = (error: SatelliteError) => void
export type RelationCallback = (relation: Relation) => void
export type AdditionalDataCallback = (
  data: AdditionalData
) => void | Promise<void>
export type TransactionCallback = (
  transaction: ServerTransaction
) => Promise<void>
export type IncomingTransactionCallback = (
  transaction: DataTransaction,
  AckCb: () => void
) => void
export type OutboundStartedCallback = () => void
export type GoneBatchCallback = (
  lsn: LSN,
  subscriptionIds: string[],
  changes: DataGone[]
) => void | Promise<void>

export type ConnectivityStatus = 'connected' | 'disconnected'
export type ConnectivityState = {
  status: ConnectivityStatus
  reason?: SatelliteError // reason for `disconnected` status
}

export type Uuid = `${string}-${string}-${string}-${string}-${string}`
