import { DbName, DbNamespace, Tablename, RowId } from '../util/types'

export interface ChangedIdentifier {
  namespace: DbNamespace,
  tablename: Tablename,
  rowid?: RowId
}

export interface ChangeNotification {
  dbName: DbName,
  changes: ChangedIdentifier[]
}

export interface CommitNotification {
  dbName: DbName
}

export interface ChangeNotifier {
  dbName: DbName

  notifyChange(changes: ChangedIdentifier[]): void
}

export interface CommitNotifier {
  dbNames: Set<DbName>

  notifications?: CommitNotification[]

  attach(dbName: DbName): void
  detach(dbName: DbName): void

  notifyCommit(): void
}

export abstract class BaseChangeNotifier implements ChangeNotifier {
  dbName: DbName

  constructor(dbName: DbName) {
    this.dbName = dbName
  }

  notifyChange(_changes: ChangedIdentifier[]): void {
    throw 'Subclasses of `BaseChangeNotifier` must implement notifyChange()'
  }
}

export abstract class BaseCommitNotifier implements CommitNotifier {
  dbNames: Set<DbName>

  constructor(dbNames: DbName | DbName[]) {
    this.dbNames = new Set(Array.isArray(dbNames) ? dbNames : [dbNames])
  }

  attach(dbName: DbName): void {
    this.dbNames.add(dbName)
  }

  detach(dbName: DbName): void {
    this.dbNames.delete(dbName)
  }

  notifyCommit(): void {
    throw 'Subclasses of `BaseCommitNotifier` must implement notifyCommit()'
  }
}
