import {
  DatabaseAdapter as DatabaseAdapterInterface,
  Transaction as Tx,
} from '../../electric/adapter'
import {
  parseTableNames,
  QualifiedTablename,
  Row,
  SqlValue,
  Statement,
} from '../../util'
import { rowsFromResults } from '../generic/results'
import { Database } from './database'

export class DatabaseAdapter implements DatabaseAdapterInterface {
  constructor(public db: Database) {}

  run({ sql, args }: Statement): Promise<void> {
    if (args && !Array.isArray(args)) {
      throw new Error(
        `cordova-sqlite-storage doesn't support named query parameters, use positional parameters instead`
      )
    }

    return new Promise<void>((resolve, reject) => {
      return this.db.transaction((tx) =>
        tx.executeSql(sql, args, () => resolve(), reject)
      )
    })
  }

  runInTransaction(...statements: Statement[]): Promise<void> {
    if (statements.some((x) => x.args && !Array.isArray(x.args))) {
      throw new Error(
        `cordova-sqlite-storage doesn't support named query parameters, use positional parameters instead`
      )
    }

    return new Promise<void>((resolve, reject) => {
      this.db.transaction(
        (tx) => {
          for (const { sql, args } of statements) {
            tx.executeSql(sql, args as SqlValue[] | undefined)
          }
        },
        reject,
        () => resolve()
      )
    })
  }

  transaction<T>(
    f: (_tx: Tx, setResult: (res: T) => void) => void
  ): Promise<T | void> {
    let result: T | void = undefined
    return new Promise<void>((resolve, reject) => {
      const txFn = (tx: SQLitePlugin.Transaction) => {
        f(new WrappedTx(tx), (res) => (result = res))
      }

      this.db.transaction(txFn, reject, resolve)
    }).then(() => result)
  }

  query({ sql, args }: Statement): Promise<Row[]> {
    if (args && !Array.isArray(args)) {
      throw new Error(
        `cordova-sqlite-storage doesn't support named query parameters, use positional parameters instead`
      )
    }

    return new Promise<Row[]>((resolve, reject) => {
      this.db.readTransaction((tx) => {
        tx.executeSql(
          sql,
          args,
          (_, results) => resolve(rowsFromResults(results)),
          reject
        )
      })
    })
  }

  tableNames(statement: Statement): QualifiedTablename[] {
    return parseTableNames(statement.sql)
  }
}

class WrappedTx implements Tx {
  constructor(private tx: SQLitePlugin.Transaction) {}

  run(
    statement: Statement,
    successCallback?: (tx: Tx) => void,
    errorCallback?: (error: any) => void
  ): void {
    this.executeSQL(
      statement,
      (tx, _res) => {
        if (typeof successCallback !== 'undefined') successCallback(tx)
      },
      errorCallback
    )
  }

  query(
    statement: Statement,
    successCallback: (tx: Tx, res: Row[]) => void,
    errorCallback?: (error: any) => void
  ): void {
    this.executeSQL(statement, successCallback, errorCallback)
  }

  private executeSQL(
    { sql, args }: Statement,
    successCallback?: (tx: Tx, res: Row[]) => void,
    errorCallback?: (error: any) => void
  ) {
    if (args && !Array.isArray(args)) {
      throw new Error(
        `cordova-sqlite-storage doesn't support named query parameters, use positional parameters instead`
      )
    }

    this.tx.executeSql(
      sql,
      args,
      (tx, res) => {
        if (typeof successCallback !== 'undefined')
          successCallback(new WrappedTx(tx), rowsFromResults(res))
      },
      (_tx, err) => {
        if (typeof errorCallback !== 'undefined') errorCallback(err)
        return true
      }
    )
  }
}
