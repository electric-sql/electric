import { QualifiedTablename } from '../util/tablename'
import { DbName, RowId } from '../util/types'

export interface Change {
  qualifiedTablename: QualifiedTablename,
  rowids?: RowId[]
}
export interface ChangeNotification {
  dbName: DbName
  changes: Change[]
}
export interface PotentialChangeNotification {
  dbName: DbName
}
export type Notification = ChangeNotification | PotentialChangeNotification

export type ChangeCallback = (notification: ChangeNotification) => void
export type PotentialChangeCallback = (notification: PotentialChangeNotification) => void
export type NotificationCallback = ChangeCallback | PotentialChangeCallback

export interface Notifier {
  // Most database clients just open a single named database. However,
  // some can attach multiple databases. We keep track of this in the
  // set of `dbNames` by providing attach and detach methods.
  dbNames: Set<DbName>
  attach(dbName: DbName): void
  detach(dbName: DbName): void

  // The notification workflow starts by the electric database clients
  // (or the user manually) calling `potentiallyChanged` following
  // a write or transaction that may have changed the contents of one
  // or more of the opened/attached databases. If `dbName` is provided,
  // it restricts the potential change to the named database (as long)
  // as it is in the set of `this.dbNames`.
  potentiallyChanged(dbName?: DbName): void

  // Satellite processes subscribe to *potential* data changes and check
  // the opslog for *actual* changes as part of the replication machinery.
  subscribeToPotentialDataChanges(callback: PotentialChangeCallback): string
  unsubscribeFromPotentialDataChanges(key: string): void

  // When Satellite detects actual data changes in the opslog for a given
  // database, it calls  `actuallyChanged` with the list of changes.
  actuallyChanged(dbName: DbName, changes: Change[]): void

  // Reactive hooks then subscribe to `ActualDataChange` notifications,
  // using the info about what has actually changed to trigger re-queries.
  // when (and only when) necessary.
  subscribeToDataChanges(callback: ChangeCallback): string
  unsubscribeFromDataChanges(key: string): void
}
