import { AuthConfig, AuthState } from '../auth/index'
import { InternalElectricConfig } from '../config/index'
import { DatabaseAdapter } from '../electric/adapter'
import { Migrator } from '../migrators/index'
import { Notifier } from '../notifiers/index'
import { SocketFactory } from '../sockets'
import {
  AckCallback,
  AuthResponse,
  DbName,
  LSN,
  SatelliteError,
  DataTransaction,
  Transaction,
  Relation,
  ClientShapeDefinition,
  SubscriptionDeliveredCallback,
  SubscribeResponse,
  ShapeRequest,
  SubscriptionErrorCallback,
} from '../util/types'

export { SatelliteProcess } from './process'
export { GlobalRegistry, globalRegistry } from './registry'

// `Registry` that starts one Satellite process per database.
export interface Registry {
  ensureStarted(
    dbName: DbName,
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

export type SatelliteReplicationOptions = { clearOnBehindWindow: boolean }

// `Satellite` is the main process handling ElectricSQL replication,
// processing the opslog and notifying when there are data changes.
export interface Satellite {
  dbName: DbName

  adapter: DatabaseAdapter
  migrator: Migrator
  notifier: Notifier

  start(
    authConfig: AuthConfig,
    opts?: SatelliteReplicationOptions
  ): Promise<ConnectionWrapper>
  stop(): Promise<void>
  subscribe(
    shapeDefinitions: ClientShapeDefinition[]
  ): Promise<void | SatelliteError>
  unsubscribe(shapeUuid: string): Promise<void | SatelliteError>
}

export interface Client {
  connect(
    retryHandler?: (error: any, attempt: number) => boolean
  ): Promise<void | SatelliteError>
  close(): Promise<void | SatelliteError>
  authenticate(authState: AuthState): Promise<AuthResponse | SatelliteError>
  isClosed(): boolean
  startReplication(
    lsn?: LSN,
    subscriptionIds?: string[]
  ): Promise<void | SatelliteError>
  stopReplication(): Promise<void | SatelliteError>
  subscribeToRelations(callback: (relation: Relation) => void): void
  subscribeToTransactions(
    callback: (transaction: Transaction) => Promise<void>
  ): void
  enqueueTransaction(transaction: DataTransaction): void | SatelliteError
  subscribeToAck(callback: AckCallback): void
  unsubscribeToAck(callback: AckCallback): void
  resetOutboundLogPositions(sent?: LSN, ack?: LSN): void
  getOutboundLogPositions(): { enqueued: LSN; ack: LSN }
  subscribeToOutboundEvent(event: 'started', callback: () => void): void
  unsubscribeToOutboundEvent(event: 'started', callback: () => void): void

  subscribe(shapes: ShapeRequest[]): Promise<SubscribeResponse>

  // TODO: there is currently no way of unsubscribing from the server
  // unsubscribe(subscriptionId: string): Promise<void>

  subscribeToSubscriptionEvents(
    successCallback: SubscriptionDeliveredCallback,
    errorCallback: SubscriptionErrorCallback
  ): void
  unsubscribeToSubscriptionEvents(
    successCallback: SubscriptionDeliveredCallback,
    errorCallback: SubscriptionErrorCallback
  ): void
}
