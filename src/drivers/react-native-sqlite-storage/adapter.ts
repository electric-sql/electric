import Log from 'loglevel'

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
import { ensurePromise } from '../generic/promise'
import { rowsFromResults } from '../generic/results'
import { Database, StatementCallback, Transaction } from './database'

export class DatabaseAdapter implements DatabaseAdapterInterface {
  constructor(public db: Database, private promisesEnabled: boolean = false) {}

  run(statement: Statement): Promise<void> {
    return this.runInTransaction(statement)
  }

  async runInTransaction(...statements: Statement[]): Promise<void> {
    if (!onlyPositionalArgs(statements)) {
      throw new Error(
        `react-native-sqlite-storage doesn't support named query parameters, use positional parameters instead`
      )
    }

    const promisesEnabled = this.promisesEnabled
    const transaction = this.db.transaction.bind(this.db)

    return new Promise<void>((resolve, reject) => {
      const txFn = (tx: Transaction) => {
        for (const { sql, args } of statements) {
          const stmtFailure = (err: any) => {
            Log.info('run statement failure', sql, err)
            reject(err)
          }
          tx.executeSql(sql, args, undefined, stmtFailure)
        }
      }

      const success = () => {
        resolve()
      }

      const failure = (err: any) => {
        Log.info('run tx failure')
        reject(err)
      }

      return promisesEnabled
        ? ensurePromise(transaction(txFn)).then(success).catch(failure)
        : transaction(txFn, failure, success)
    })
  }

  transaction<T>(
    f: (_tx: Tx, setResult: (res: T) => void) => void
  ): Promise<T | void> {
    let result: T | void = undefined
    return new Promise((resolve, reject) => {
      const txFn = (tx: Transaction) => {
        f(new WrappedTx(tx), (res) => (result = res))
      }

      this.db.transaction(txFn, reject, resolve)
    }).then(() => result)
  }

  query({ sql, args }: Statement): Promise<Row[]> {
    if (args && !Array.isArray(args)) {
      throw new Error(
        `react-native-sqlite-storage doesn't support named query parameters, use positional parameters instead`
      )
    }

    const promisesEnabled = this.promisesEnabled
    const readTransaction = this.db.readTransaction.bind(this.db)

    return new Promise<Row[]>((resolve, reject) => {
      const success: StatementCallback = (_tx, results) => {
        resolve(rowsFromResults(results))
      }

      const txFn = (tx: Transaction) => {
        return promisesEnabled
          ? ensurePromise(tx.executeSql(sql, args))
              .then((args) => success(...args))
              .catch(reject)
          : tx.executeSql(sql, args, success, reject)
      }

      readTransaction(txFn)
    })
  }

  tableNames({ sql }: Statement): QualifiedTablename[] {
    return parseTableNames(sql)
  }
}

type PositionalStatement = { sql: string; args?: SqlValue[] }
function onlyPositionalArgs(
  statements: Statement[]
): statements is PositionalStatement[] {
  return statements.every((x) => !x.args || Array.isArray(x.args))
}

class WrappedTx implements Tx {
  constructor(private tx: Transaction) {}

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
        `react-native-sqlite-storage doesn't support named query parameters, use positional parameters instead`
      )
    }

    this.tx.executeSql(
      sql,
      args ? (args as any) : [],
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
