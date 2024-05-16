import Long from 'long'
import { AuthConfig, AuthState } from '../auth/index'
import { InternalElectricConfig } from '../config/index'
import { DatabaseAdapter } from '../electric/adapter'
import { Migrator } from '../migrators/index'
import { Notifier } from '../notifiers/index'
import { SocketFactory } from '../sockets'
import {
  AuthResponse,
  ConnectivityState,
  DbName,
  LSN,
  DataTransaction,
  StartReplicationResponse,
  StopReplicationResponse,
  ErrorCallback,
  TransactionCallback,
  RelationCallback,
  OutboundStartedCallback,
  SatelliteError,
  ReplicationStatus,
  AdditionalDataCallback,
  DbRecord,
  ReplicatedRowTransformer,
  GoneBatchCallback,
} from '../util/types'
import {
  ShapeRequest,
  SubscribeResponse,
  SubscriptionDeliveredCallback,
  SubscriptionErrorCallback,
  UnsubscribeResponse,
} from './shapes/types'
import { DbSchema } from '../client/model/schema'
import { QualifiedTablename } from '../util'
import { IShapeManager } from '../client/model/shapes'

export { MockRegistry } from './mock'
export { SatelliteProcess } from './process'
export { GlobalRegistry, globalRegistry } from './registry'
export type { ShapeSubscription } from './process'
export type { Shape, Rel } from './shapes/types'

// `Registry` that starts one Satellite process per database.
export interface Registry {
  satellites: {
    [key: DbName]: Satellite
  }

  ensureStarted(
    dbName: DbName,
    dbDescription: DbSchema<any>,
    adapter: DatabaseAdapter,
    migrator: Migrator,
    notifier: Notifier,
    socketFactory: SocketFactory,
    config: InternalElectricConfig
  ): Promise<Satellite>
  ensureAlreadyStarted(dbName: DbName): Promise<Satellite>
  stop(dbName: DbName): Promise<void>
  stopAll(): Promise<void>
}

// `Satellite` is the main process handling ElectricSQL replication,
// processing the opslog and notifying when there are data changes.
export interface Satellite extends IShapeManager {
  dbName: DbName

  adapter: DatabaseAdapter
  migrator: Migrator
  notifier: Notifier

  connectivityState?: ConnectivityState

  start(authConfig: AuthConfig): Promise<void>
  stop(shutdown?: boolean): Promise<void>
  setToken(token?: string): void
  hasToken(): boolean
  connectWithBackoff(): Promise<void>
  disconnect(error?: SatelliteError): void
  clientDisconnect(): void
  authenticate(token: string): Promise<void>

  setReplicationTransform(
    tableName: QualifiedTablename,
    transform: ReplicatedRowTransformer<DbRecord>
  ): void
  clearReplicationTransform(tableName: QualifiedTablename): void
}

export interface Client {
  connect(): Promise<void>
  disconnect(): void
  shutdown(): void
  authenticate(authState: AuthState): Promise<AuthResponse>
  isConnected(): boolean
  getOutboundReplicationStatus(): ReplicationStatus
  startReplication(
    lsn?: LSN,
    schemaVersion?: string,
    subscriptionIds?: string[],
    observedTransactionData?: Long[]
  ): Promise<StartReplicationResponse>
  stopReplication(): Promise<StopReplicationResponse>
  subscribeToRelations(callback: RelationCallback): void
  unsubscribeToRelations(callback: RelationCallback): void
  subscribeToTransactions(callback: TransactionCallback): void
  unsubscribeToTransactions(callback: TransactionCallback): void
  subscribeToAdditionalData(callback: AdditionalDataCallback): void
  unsubscribeToAdditionalData(callback: AdditionalDataCallback): void
  subscribeToGoneBatch(callback: GoneBatchCallback): void
  unsubscribeToGoneBatch(callback: GoneBatchCallback): void
  enqueueTransaction(transaction: DataTransaction): void
  getLastSentLsn(): LSN
  subscribeToOutboundStarted(callback: OutboundStartedCallback): void
  unsubscribeToOutboundStarted(callback: OutboundStartedCallback): void
  subscribeToError(callback: ErrorCallback): void
  unsubscribeToError(callback: ErrorCallback): void

  subscribe(subId: string, shapes: ShapeRequest[]): Promise<SubscribeResponse>
  unsubscribe(subIds: string[]): Promise<UnsubscribeResponse>

  subscribeToSubscriptionEvents(
    successCallback: SubscriptionDeliveredCallback,
    errorCallback: SubscriptionErrorCallback
  ): void
  unsubscribeToSubscriptionEvents(
    successCallback: SubscriptionDeliveredCallback,
    errorCallback: SubscriptionErrorCallback
  ): void

  setReplicationTransform(
    tableName: QualifiedTablename,
    transformer: ReplicatedRowTransformer<DbRecord>
  ): void
  clearReplicationTransform(tableName: QualifiedTablename): void
}
