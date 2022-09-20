import { AuthState } from '../auth/index'
import { DatabaseAdapter } from '../electric/adapter'
import { Migrator } from '../migrators/index'
import { Notifier } from '../notifiers/index'
import { DbName } from '../util/types'

// `Registry` that starts one Satellite process per database.
export interface Registry {
  ensureStarted(dbName: DbName, adapter: DatabaseAdapter, migrator: Migrator, notifier: Notifier, authState?: AuthState): Promise<Satellite>
  ensureAlreadyStarted(dbName: DbName): Promise<Satellite>
  stop(dbName: DbName): Promise<void>
  stopAll(): Promise<void>
}

// `Satellite` is the main process handling Electric SQL replication,
// processing the opslog and notifying when there are data changes.
export interface Satellite {
  dbName: DbName

  adapter: DatabaseAdapter
  migrator: Migrator
  notifier: Notifier

  start(authState?: AuthState): Promise<void | Error>
  stop(): Promise<void>
}
