import { Database, SqlValue } from '@sqlite.org/sqlite-wasm'
import { ElectricSync, ElectricSyncOptions } from '../sync'
import { Mutex } from '../util/mutex'
import { makeElectricSync } from '../sqlite'
import {
  ArgsType,
  ParamsType,
  ResultType,
  SQLiteDbWithElectricSync,
  SQLiteStatement,
} from '.'

export class SQLiteWasmWrapper implements SQLiteDbWithElectricSync {
  private _db: Database
  private mutex: Mutex = new Mutex()

  electric: ElectricSync

  constructor(sqlite: Database, options?: ElectricSyncOptions) {
    const { electric } = makeElectricSync(this, options)

    this._db = sqlite
    this.electric = electric
  }

  get db() {
    return this._db
  }

  async acquire() {
    await this.mutex.acquire()
  }

  release() {
    this.mutex.release()
  }

  close() {
    this.db.close()
  }

  /**
   * Execute raw SQL
   */
  // TODO: add back callback
  exec<T = { [column: string]: SqlValue }>(
    sql: string
  ): Promise<T | undefined> {
    const res = this.db.selectValue(sql) as T | undefined
    return Promise.resolve(res)
  }

  /**
   * Run a function within a transaction that can do execute multiple sql statements
   * The transaction will be committed if the function resolves without error
   * The transaction will be rolled back if the function throws an error
   */
  async transaction<T>(
    fn: (db: SQLiteDbWithElectricSync) => Promise<T>
  ): Promise<T> {
    try {
      await this.mutex.acquire()
      this.exec('BEGIN TRANSACTION')
      const result = await fn(this)
      this.exec('COMMIT')
      return result
    } catch (error) {
      try {
        this.exec('ROLLBACK')
      } catch (rollbackError) {
        console.error('Error during rollback:', rollbackError)
      }
      throw error
    } finally {
      this.mutex.release()
    }
  }

  /**
   * Prepare a statement
   */
  prepare<P extends ParamsType>(sql: string): SQLiteStatement<P> {
    // Create a statement object with the required methods
    const stmt = this.db.prepare(sql)

    return {
      run: (...params) => {
        if (params.length > 1) {
          for (let i = 0; i < params.length; i++) {
            stmt.bind(i + 1, params[i] as SqlValue)
          }
        } else if (params.length === 1) {
          stmt.bind(params[0] as any) // Handle named parameters or array
        }
        stmt.step()
        return Promise.resolve()
      },

      get: <R extends ResultType>(...params: ArgsType<P>) => {
        if (params.length > 1) {
          for (let i = 0; i < params.length; i++) {
            stmt.bind(i + 1, params[i] as SqlValue)
          }
        } else if (params.length === 1) {
          stmt.bind(params[0] as any) // Handle named parameters or array
        }

        const res = stmt.step() ? (stmt.get({}) as R) : undefined
        return Promise.resolve(res)
      },

      all: <R extends ResultType>(...params: ArgsType<P>) => {
        if (params.length > 1) {
          for (let i = 0; i < params.length; i++) {
            stmt.bind(i + 1, params[i] as SqlValue)
          }
        } else if (params.length === 1) {
          stmt.bind(params[0] as any) // Handle named parameters or array
        }

        const results: R[] = []
        while (stmt.step()) {
          results.push(stmt.get({}) as R)
        }
        return Promise.resolve(results)
      },

      finalize: () => {
        if (stmt.finalize) {
          stmt.finalize()
        }
      },
    }
  }
}
