import { ElectricNamespace } from '../../electric/index'
import { ProxyWrapper } from '../../proxy/index'
import type { DbName } from '../../util'
import type {
  Database as OriginalDatabase,
  WebSQLDatabase as OriginalWebSQLDatabase,
  SQLTransactionCallback,
  SQLTransactionErrorCallback,
  SQLiteCallback,
  Query,
} from 'expo-sqlite'
export type { SQLTransaction as Transaction } from 'expo-sqlite'

export type Database = (OriginalDatabase | OriginalWebSQLDatabase) & {
  _name?: DbName
}

export class ElectricDatabase
  implements ProxyWrapper, Pick<OriginalDatabase, 'transaction'>
{
  _db: Database

  // The public property we add to the underlying Database client,
  electric: ElectricNamespace

  constructor(db: Database, namespace: ElectricNamespace) {
    this._db = db
    this.electric = namespace
  }

  // Used when re-proxying so the proxy code doesn't need
  // to know the property name.
  _setOriginal(db: Database): void {
    this._db = db
  }
  _getOriginal(): Database {
    return this._db
  }

  transaction(
    callback: SQLTransactionCallback,
    error?: SQLTransactionErrorCallback,
    success?: () => void
  ): void {
    const wrappedSuccess = (): void => {
      this.electric.potentiallyChanged()

      if (success !== undefined) {
        success()
      }
    }

    return this._db.transaction(callback, error, wrappedSuccess)
  }
}

export class ElectricWebSQLDatabase
  extends ElectricDatabase
  implements Pick<OriginalWebSQLDatabase, 'exec'>
{
  declare _db: OriginalWebSQLDatabase

  exec(queries: Query[], readOnly: boolean, callback: SQLiteCallback): void {
    const wrappedCallback: SQLiteCallback = (error, resultSet) => {
      const isPotentiallyDangerous = readOnly === false
      const mayHaveRunQueryBeforeError = queries.length > 1
      const didNotError = error === undefined || error === null

      if (
        isPotentiallyDangerous &&
        (didNotError || mayHaveRunQueryBeforeError)
      ) {
        this.electric.potentiallyChanged()
      }

      callback(error, resultSet)
    }

    return this._db.exec(queries, readOnly, wrappedCallback)
  }

  // XXX not sure how to handle the methods below. We want to notify
  // queries that the db has closed but our code will break because
  // the db handle has been closed. Maybe we need a new "db gone" /
  // "all data actually changed" notification.

  // async closeAsync(): Promise<void> {
  //   await this._db.closeAsync()

  //   this.electric.potentiallyChanged()
  // }

  // async deleteAsync(): Promise<void> {
  //   await this._db.closeAsync()

  //   this.electric.potentiallyChanged()
  // }
}

type ElectrifiedExpoDatabase<T extends OriginalDatabase> = T & ElectricDatabase
type ElectrifiedWebSQLDatabase<T extends OriginalWebSQLDatabase> = T &
  ElectricWebSQLDatabase
export type ElectrifiedDatabase<
  T extends OriginalDatabase = OriginalDatabase | OriginalWebSQLDatabase
> = T extends OriginalWebSQLDatabase
  ? ElectrifiedWebSQLDatabase<T>
  : ElectrifiedExpoDatabase<T>
