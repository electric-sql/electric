import { ElectricNamespace } from '../../electric/index'
import { ProxyWrapper } from '../../proxy/index'
import { DbName } from '../../util/types'

declare class SQLError {
  static UNKNOWN_ERR: number
  static DATABASE_ERR: number
  static VERSION_ERR: number
  static TOO_LARGE_ERR: number
  static QUOTA_ERR: number
  static SYNTAX_ERR: number
  static CONSTRAINT_ERR: number
  static TIMEOUT_ERR: number

  code: number
  message: string
}

type ResultSet = {
  insertId?: number
  rowsAffected: number
  rows: { [column: string]: any }[]
}
type ResultSetError = {
  error: Error
}
type SQLResultSet = {
  insertId?: number
  rowsAffected: number
  rows: SQLResultSetRowList
}
interface SQLResultSetRowList {
  length: number

  item(index: number): any
  _array: any[]
}
type SQLStatementCallback = (transaction: Transaction, resultSet: SQLResultSet) => void
type SQLStatementErrorCallback = (transaction: Transaction, error: SQLError) => boolean

export type TransactionCallback = (transaction: Transaction) => void
export type TransactionErrorCallback = (error: SQLError) => void

export type Query = {
  sql: string,
  args: (number | string | null)[]
}
export type SQLiteCallback = (error?: Error | null, resultSet?: (ResultSetError | ResultSet)[]) => void

export interface Transaction {
  executeSql(
    sqlStatement: string, args?: (number | string | null)[],
    callback?: SQLStatementCallback,
    errorCallback?: SQLStatementErrorCallback): void
}

export interface NamedExpoDatabase {
  _name: DbName
  version: string

  transaction(
    callback: TransactionCallback,
    errorCallback?: TransactionErrorCallback,
    successCallback?: () => void
  ): void
  readTransaction(
    callback: TransactionCallback,
    errorCallback?: TransactionErrorCallback,
    successCallback?: () => void
  ): void
}

export interface NamedWebSQLDatabase extends NamedExpoDatabase {
  exec(queries: Query[], readOnly: boolean, callback: SQLiteCallback): void
  closeAsync(): void
  deleteAsync(): Promise<void>
}

export type Database = NamedExpoDatabase | NamedWebSQLDatabase

export class ElectricDatabase implements ProxyWrapper {
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

  transaction(callback: TransactionCallback, error?: TransactionErrorCallback, success?: () => void): void {
    const wrappedSuccess = (): void => {
      this.electric.potentiallyChanged()

      if (success !== undefined) {
        success()
      }
    }

    return this._db.transaction(callback, error, wrappedSuccess)
  }
}

export class ElectricWebSQLDatabase extends ElectricDatabase {
  declare _db: NamedWebSQLDatabase

  exec(queries: Query[], readOnly: boolean, callback: SQLiteCallback): void {
    const wrappedCallback: SQLiteCallback = (error?: Error | null, resultSet?: (ResultSetError | ResultSet)[]): void => {
      const isPotentiallyDangerous = readOnly === false
      const mayHaveRunQueryBeforeError = queries.length > 1
      const didNotError = error === undefined || error === null

      if (isPotentiallyDangerous && (didNotError || mayHaveRunQueryBeforeError)) {
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

interface ElectrifiedExpoDatabase extends NamedExpoDatabase, ElectricDatabase {}
interface ElectrifiedWebSQLDatabase extends NamedWebSQLDatabase, ElectricWebSQLDatabase {}
export type ElectrifiedDatabase = ElectrifiedExpoDatabase | ElectrifiedWebSQLDatabase
