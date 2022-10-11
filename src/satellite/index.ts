import { AuthState } from '../auth/index'
import { DatabaseAdapter } from '../electric/adapter'
import { Migrator } from '../migrators/index'
import { Notifier } from '../notifiers/index'
import { Socket } from '../sockets'
import { AckCallback, AuthResponse, DbName, LSN, SatelliteError, Transaction } from '../util/types'

export { SatelliteProcess } from './process'
export { GlobalRegistry, globalRegistry } from './registry'

// `Registry` that starts one Satellite process per database.
export interface Registry {
  ensureStarted(dbName: DbName, adapter: DatabaseAdapter, migrator: Migrator, notifier: Notifier, socket: Socket, authState?: AuthState): Promise<Satellite>
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
  connect(): Promise<void | SatelliteError>;
  close(): Promise<void | SatelliteError>;
  authenticate(): Promise<AuthResponse | SatelliteError>;
  startReplication(lsn: LSN): Promise<void | SatelliteError>;
  stopReplication(): Promise<void | SatelliteError>;
  subscribeToTransactions(callback: (transaction: Transaction) => Promise<void>): void;
  enqueueTransaction(transaction: Transaction): void | SatelliteError
  subscribeToAck(callback: AckCallback): void;
  unsubscribeToAck(callback: AckCallback): void;
  setOutboundLogPositions(sent: LSN, ack: LSN): void;
}
