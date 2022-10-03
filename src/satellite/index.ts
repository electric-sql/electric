import { AuthState } from '../auth/index'
import { DatabaseAdapter } from '../electric/adapter'
import { Migrator } from '../migrators/index'
import { Notifier } from '../notifiers/index'
import { AuthResponse, DbName, SatelliteError, Transaction } from '../util/types'

// `Registry` that starts one Satellite process per database.
export interface Registry {
  ensureStarted(dbName: DbName, adapter: DatabaseAdapter, migrator: Migrator, notifier: Notifier, authState?: AuthState): Promise<Satellite>
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

export enum AckType {
  SENT,
  PERSISTED
}

export type AckCallback = (lsn: string, type: AckType) => void


export interface Client {
  connect(): Promise<void | SatelliteError>;
  close(): Promise<void | SatelliteError>;
  authenticate(): Promise<AuthResponse | SatelliteError>;
  startReplication(lsn: string): Promise<void | SatelliteError>;
  stopReplication(): Promise<void | SatelliteError>;
  subscribeToTransactions(callback: (transaction: Transaction) => Promise<void>): void;
  enqueueTransaction(transaction: Transaction): void | SatelliteError
  subscribeToAck(callback: AckCallback): void;
  unsubscribeToAck(callback: AckCallback): void;
  setOutboundLogPositions(sent: string, ack: string): void;
}
