import { Database } from 'better-sqlite3'
import type {
  ParamsType,
  SqliteWrapper,
  SQLiteStatement,
  ResultType,
  ArgsType,
} from './index'

/**
 * Creates a SqliteWrapper from a better-sqlite3 Database instance
 * @param db A better-sqlite3 Database instance
 * @returns A SqliteWrapper implementation using better-sqlite3
 * @throws Error if better-sqlite3 is not installed
 */
export const betterSqliteWrapper = (db: Database): SqliteWrapper => ({
  txOpen: false,

  exec(sql: string) {
    db.exec(sql)
    return Promise.resolve()
  },

  /**
   * Prepare a statement
   */
  prepare<P extends ParamsType>(sql: string): SQLiteStatement<P> {
    const stmt = db.prepare(sql)
    return {
      /**
       * Run the prepared statement with parameters
       */
      async run(...params: ArgsType<P>): Promise<void> {
        stmt.run(...params)
      },

      /**
       * Get a single row from the prepared statement
       */
      async get<R extends ResultType>(
        ...params: ArgsType<P>
      ): Promise<R | undefined> {
        const result = stmt.get(...params) as R | undefined
        return Promise.resolve(result)
      },

      /**
       * Get all rows from the prepared statement
       */
      async all<R extends ResultType>(...params: ArgsType<P>): Promise<R[]> {
        const results = stmt.all(...params) as R[]
        return Promise.resolve(results)
      },

      /**
       * Finalize the prepared statement
       */
      finalize() {
        // better-sqlite3 doesn't have an explicit finalize method
        // Statements are automatically finalized when the database connection is closed
        // or when they are garbage collected
        // Return 0 to indicate success
        return 0
      },
    }
  },

  /**
   * Execute a function within a transaction
   */
  async transaction<T>(fn: (tx: SqliteWrapper) => T | Promise<T>): Promise<T> {
    try {
      db.exec(`BEGIN TRANSACTION`)
      this.txOpen = true
      const res = await fn(this)
      if (this.txOpen) {
        db.exec(`COMMIT`)
      }
      return res
    } catch (error) {
      if (this.txOpen) {
        db.exec(`ROLLBACK`)
      }
      throw error
    } finally {
      this.txOpen = false
    }
  },

  /**
   * Close the database connection
   */
  close() {
    db.close()
  },

  rollback() {
    if (this.txOpen) {
      db.exec(`ROLLBACK`)
      this.txOpen = false
    }
  },
})
