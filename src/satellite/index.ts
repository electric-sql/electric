import { AnyDatabase } from '../adapters/index'
import { Filesystem } from '../filesystems/index'
import { ChangeNotifier } from '../notifiers/index'
import { BindParams, DbName, Row } from '../util/types'

// `Satellite` is the main process handling Electric SQL replication.
//
// A Satellite instance is instantiated with a normalised `db` client,
// `fs`, a normalised filesystem adapter, and a `dbName` and `notifier`.
//
// It uses the filesystem to apply migrations, the database client to
// execute migrations and perform read and write operations. And it uses
// the `dbName` and `notifier` to recieve commit notifications and emit
// table and row scoped data-changed notifications.
export interface Satellite {
  dbAdapter: SatelliteDatabaseAdapter
  dbName: DbName
  fs: Filesystem
  changeNotifier: ChangeNotifier

  stop(): Promise<void>
}

// `SatelliteDatabaseAdapter`s adapt a database client to provide the normalised
// interface defined here. This allows the satellite instance to
// interact with the database in a standardised way.
export interface SatelliteDatabaseAdapter {
  db: AnyDatabase

  // Runs sql against the DB, inside a transaction. If it's a success,
  // the promise resolves. Any errors, the transaction is rolled back
  // and the promise rejected.
  exec(sql: string): Promise<void>

  // Runs a query against the database, returning a promise. If the
  // query succeeds, the promise resolves with a list of rows.
  query(sql: string, bindParams?: BindParams): Promise<Row[]>
}

// The `SatelliteRegistry` is intended to be a global singleton that
// starts and stops replication processing for every SQLite database
// that the application is using.
export interface SatelliteRegistry {
  ensureStarted(dbName: DbName, dbAdapter: SatelliteDatabaseAdapter, fs: Filesystem): Promise<Satellite>
  stop(dbName: DbName): Promise<void>
  stopAll(): Promise<void>
}
