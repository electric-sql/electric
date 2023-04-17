import { AuthState } from '../auth/index'
import { QualifiedTablename } from '../util/tablename'
import { ConnectivityState, DbName, RowId } from '../util/types'

export { EventNotifier } from './event'
export { MockNotifier } from './mock'

export interface AuthStateNotification {
  authState: AuthState
}

export interface Change {
  qualifiedTablename: QualifiedTablename
  rowids?: RowId[]
}
export interface ChangeNotification {
  dbName: DbName
  changes: Change[]
}
export interface PotentialChangeNotification {
  dbName: DbName
}

export interface ConnectivityStateChangeNotification {
  dbName: DbName
  connectivityState: ConnectivityState
}

export type Notification =
  | AuthStateNotification
  | ChangeNotification
  | PotentialChangeNotification
  | ConnectivityStateChangeNotification

export type AuthStateCallback = (notification: AuthStateNotification) => void
export type ChangeCallback = (notification: ChangeNotification) => void
export type PotentialChangeCallback = (
  notification: PotentialChangeNotification
) => void
export type ConnectivityStateChangeCallback = (
  notification: ConnectivityStateChangeNotification
) => void

export type NotificationCallback =
  | AuthStateCallback
  | ChangeCallback
  | PotentialChangeCallback
  | ConnectivityStateChangeCallback

export interface Notifier {
  // The name of the primary database that components communicating via this
  // notifier have open and are using.
  dbName: DbName

  // Some drivers can attach other open databases and reference them by alias
  // (i.e.: first you `attach('foo.db')` then you can write SQL queries like
  // `select * from foo.bars`. We keep track of attached databases and their
  // aliases, so we can map the table namespaces in SQL queries to their real
  // database names and thus emit and handle notifications to and from them.
  attach(dbName: DbName, dbAlias: string): void
  detach(dbAlias: string): void

  // Technically, we keep track of the attached dbs in two mappings -- one is
  // `alias: name`, the other `name: alias`.
  attachedDbIndex: {
    byAlias: {
      [key: string]: DbName
    }
    byName: {
      [key: DbName]: string
    }
  }

  // And we provide a helper method to alias changes in the form
  // `{attachedDbName, tablenames}` to `aliasedTablenames`.
  alias(notification: ChangeNotification): QualifiedTablename[]

  // Calling `authStateChanged` notifies the Satellite process that the
  // user's authentication credentials have changed.
  authStateChanged(authState: AuthState): void
  subscribeToAuthStateChanges(callback: AuthStateCallback): string
  unsubscribeFromAuthStateChanges(key: string): void

  // The data change notification workflow starts by the electric database
  // clients (or the user manually) calling `potentiallyChanged` whenever
  // a write or transaction has been issued that may have changed the
  // contents of either the primary or any of the attached databases.
  potentiallyChanged(): void

  // Satellite processes subscribe to these "data has potentially changed"
  // notifications. When they get one, they check the `_oplog` table in the
  // database for *actual* changes persisted by the triggers.
  subscribeToPotentialDataChanges(callback: PotentialChangeCallback): string
  unsubscribeFromPotentialDataChanges(key: string): void

  // When Satellite detects actual data changes in the oplog for a given
  // database, it replicates it and calls  `actuallyChanged` with the list
  // of changes.
  actuallyChanged(dbName: DbName, changes: Change[]): void

  // Reactive hooks then subscribe to "data has actually changed" notifications,
  // using the info to trigger re-queries, iff the changes affect databases and
  // tables that their queries depend on. This then trigger re-rendering iff
  // the query results are actually affected by the data changes.
  subscribeToDataChanges(callback: ChangeCallback): string
  unsubscribeFromDataChanges(key: string): void

  // Notification for network connectivity state changes.
  // A connectivity change s can be triggered manually,
  // or automatically in consequence of internal client events.
  // 'available': network is, or has become, available
  // 'connected': connection to Electric established
  // 'disconnected': Electric is unreachable, or network is unavailable
  // 'error': disconnected with an error (TODO: add error info)
  connectivityStateChange(dbName: string, state: ConnectivityState): void

  subscribeToConnectivityStateChange(
    callback: ConnectivityStateChangeCallback
  ): string
  unsubscribeFromConnectivityStateChange(key: string): void
}
