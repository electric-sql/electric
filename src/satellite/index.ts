import { AuthState } from '../auth/index'
import { DatabaseAdapter } from '../electric/adapter'
import { Migrator } from '../migrators/index'
import { Notifier } from '../notifiers/index'
import { SocketFactory } from '../sockets'
import { AckCallback, AuthResponse, DbName, LSN, SatelliteError, Transaction } from '../util/types'

export { SatelliteProcess } from './process'
export { GlobalRegistry, globalRegistry } from './registry'
import { ElectricConfig } from './config'

// `Registry` that starts one Satellite process per database.
export interface Registry {
  ensureStarted(dbName: DbName, adapter: DatabaseAdapter, migrator: Migrator, notifier: Notifier, socketFactory: SocketFactory, config: ElectricConfig, authState?: AuthState): Promise<Satellite>
  ensureAlreadyStarted(dbName: DbName): Promise<Satellite>
  stop(dbName: DbName): Promise<void>
  stopAll(): Promise<void>
}

// `Satellite` is the main process handling ElectricSQL replication,
// processing the opslog and notifying when there are data changes.
export interface Satellite {
  dbName: DbName

  adapter: DatabaseAdapter
  migrator: Migrator
  notifier: Notifier

  start(authState?: AuthState): Promise<void | Error>
  stop(): Promise<void>
}


export interface Client {
  connect(retryHandler?: (error: any, attempt: number) => boolean): Promise<void | SatelliteError>;
  close(): Promise<void | SatelliteError>;
  authenticate(clientId: string): Promise<AuthResponse | SatelliteError>;
  isClosed(): boolean;
  startReplication(lsn: LSN): Promise<void | SatelliteError>;
  stopReplication(): Promise<void | SatelliteError>;
  subscribeToTransactions(callback: (transaction: Transaction) => Promise<void>): void;
  enqueueTransaction(transaction: Transaction): void | SatelliteError
  subscribeToAck(callback: AckCallback): void;
  unsubscribeToAck(callback: AckCallback): void;
  resetOutboundLogPositions(sent: LSN, ack: LSN): void;
  getOutboundLogPositions(): { enqueued: LSN, ack: LSN };
  subscribeToOutboundEvent(event: 'started', callback: () => void): void;
  unsubscribeToOutboundEvent(event: 'started', callback: () => void): void;
}
