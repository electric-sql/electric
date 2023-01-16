import { ElectricNamespace } from '../../electric/index'
import { ProxyWrapper } from '../../proxy'
import { DbName } from '../../util/types'

// A bit of a hack, but that let's us reference the actual types of the library
type OriginalDatabase = SQLitePlugin.Database

// The relevant subset of the SQLitePlugin database client API
// that we need to ensure the client we're electrifying provides.
export interface Database
  extends Pick<
    OriginalDatabase,
    'executeSql' | 'transaction' | 'readTransaction' | 'sqlBatch'
  > {
  // Cordova calls the database name `.dbname` using camel case.
  // this is diffferent to React Native which uses `.dbname`.
  dbname?: DbName
}

function notifyOnSuccess<T extends (...args: any[]) => any = () => void>(
  fn: T | undefined,
  ns: ElectricNamespace
) {
  return (...args: Parameters<T>): ReturnType<T> | void => {
    ns.potentiallyChanged()
    if (fn !== undefined) return fn(...args)
  }
}

// Wrap the database client to automatically notify on commit.
export class ElectricDatabase
  implements
    ProxyWrapper,
    Pick<OriginalDatabase, 'executeSql' | 'transaction' | 'sqlBatch'>
{
  // Private properties are not exposed via the proxy.
  _db: Database
  // The public property we add to the underlying Database client,
  electric: ElectricNamespace

  constructor(db: Database, namespace: ElectricNamespace) {
    this._db = db
    this.electric = namespace
  }

  _getOriginal() {
    return this._db
  }
  _setOriginal(original: Database): void {
    this._db = original
  }

  executeSql(
    statement: string,
    params?: any[],
    success?: SQLitePlugin.StatementSuccessCallback,
    error?: SQLitePlugin.ErrorCallback
  ): void {
    this._db.executeSql(
      statement,
      params,
      notifyOnSuccess(success, this.electric),
      error
    )
  }
  sqlBatch(
    sqlStatements: (string | [string, any[]])[],
    success?: SQLitePlugin.SuccessCallback | undefined,
    error?: SQLitePlugin.ErrorCallback | undefined
  ): void {
    this._db.sqlBatch(
      sqlStatements,
      notifyOnSuccess(success, this.electric),
      error
    )
  }
  transaction(
    fn: SQLitePlugin.TransactionFunction,
    error?: SQLitePlugin.ErrorCallback | undefined,
    success?: SQLitePlugin.SuccessCallback | undefined
  ): void {
    this._db.transaction(fn, error, notifyOnSuccess(success, this.electric))
  }
}

export type ElectrifiedDatabase<T extends Database = Database> = T &
  ElectricDatabase
