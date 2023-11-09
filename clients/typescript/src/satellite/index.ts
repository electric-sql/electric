import { AuthConfig, AuthState } from '../auth/index.js'
import { InternalElectricConfig } from '../config/index.js'
import { DatabaseAdapter } from '../electric/adapter.js'
import { Migrator } from '../migrators/index.js'
import { Notifier } from '../notifiers/index.js'
import { SocketFactory } from '../sockets/index.js'
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
} from '../util/types.js'
import {
  ClientShapeDefinition,
  ShapeRequest,
  SubscribeResponse,
  SubscriptionDeliveredCallback,
  SubscriptionErrorCallback,
  UnsubscribeResponse,
} from './shapes/types.js'
import { ShapeSubscription } from './process.js'
import { DbSchema } from '../client/model/schema.js'

export { SatelliteProcess } from './process.js'
export { GlobalRegistry, globalRegistry } from './registry.js'
export type { ShapeSubscription } from './process.js'

// `Registry` that starts one Satellite process per database.
export interface Registry {
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

export type ConnectionWrapper = {
  connectionPromise: Promise<void | Error>
}

// `Satellite` is the main process handling ElectricSQL replication,
// processing the opslog and notifying when there are data changes.
export interface Satellite {
  dbName: DbName

  adapter: DatabaseAdapter
  migrator: Migrator
  notifier: Notifier

  connectivityState?: ConnectivityState

  start(authConfig: AuthConfig): Promise<ConnectionWrapper>
  stop(shutdown?: boolean): Promise<void>
  subscribe(
    shapeDefinitions: ClientShapeDefinition[]
  ): Promise<ShapeSubscription>
  unsubscribe(shapeUuid: string): Promise<void>
}

export interface Client {
  connect(): Promise<void>
  disconnect(): void
  shutdown(): void
  authenticate(authState: AuthState): Promise<AuthResponse>
  isConnected(): boolean
  startReplication(
    lsn?: LSN,
    schemaVersion?: string,
    subscriptionIds?: string[]
  ): Promise<StartReplicationResponse>
  stopReplication(): Promise<StopReplicationResponse>
  subscribeToRelations(callback: RelationCallback): void
  unsubscribeToRelations(callback: RelationCallback): void
  subscribeToTransactions(callback: TransactionCallback): void
  unsubscribeToTransactions(callback: TransactionCallback): void
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
}
