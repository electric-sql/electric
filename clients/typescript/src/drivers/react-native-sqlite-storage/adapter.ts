import Log from 'loglevel'

import {
  DatabaseAdapter as DatabaseAdapterInterface,
  RunResult,
  TableNameImpl,
  Transaction as Tx,
} from '../../electric/adapter'
import { Row, SqlValue, Statement } from '../../util'
import { ensurePromise } from '../util/promise'
import { rowsFromResults } from '../util/results'
import { isInsertUpdateOrDeleteStatement } from '../../util/statements'
import { Database, Transaction, StatementCallback } from './database'

export class DatabaseAdapter
  extends TableNameImpl
  implements DatabaseAdapterInterface
{
  constructor(public db: Database, private promisesEnabled: boolean = false) {
    super()
  }

  run(statement: Statement): Promise<RunResult> {
    return this.runInTransaction(statement)
  }

  async runInTransaction(...statements: Statement[]): Promise<RunResult> {
    if (!onlyPositionalArgs(statements)) {
      throw new Error(
        `react-native-sqlite-storage doesn't support named query parameters, use positional parameters instead`
      )
    }

    const promisesEnabled = this.promisesEnabled
    const transaction = this.db.transaction.bind(this.db)

    return new Promise<RunResult>((resolve, reject) => {
      let rowsAffected = 0
      const txFn = (tx: Transaction) => {
        for (const { sql, args } of statements) {
          const stmtFailure = (err: any) => {
            Log.info('run statement failure', sql, err)
            reject(err)
          }
          tx.executeSql(
            sql,
            args,
            (tx2, _res) => {
              if (isInsertUpdateOrDeleteStatement(sql)) {
                // Fetch the number of rows affected by the last insert, update, or delete
                // Fetch it manually because `_res.affectedRows` is wrong
                tx2.executeSql('SELECT changes()', undefined, (_, res) => {
                  rowsAffected += res.rows.length
                })
              }
            },
            stmtFailure
          )
        }
      }

      const success = () => {
        resolve({
          rowsAffected: rowsAffected,
        })
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
    successCallback?: (tx: Tx, res: RunResult) => void,
    errorCallback?: (error: any) => void
  ): void {
    this.executeSQL(
      statement,
      (tx, _rows, res) => {
        if (typeof successCallback !== 'undefined') successCallback(tx, res)
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
    successCallback?: (tx: Tx, rows: Row[], res: RunResult) => void,
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
          successCallback(new WrappedTx(tx), rowsFromResults(res), {
            rowsAffected: res.rowsAffected,
          })
      },
      (_tx, err) => {
        if (typeof errorCallback !== 'undefined') errorCallback(err)
        return true
      }
    )
  }
}
