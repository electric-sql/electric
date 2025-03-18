import { Database, SqlValue } from '@sqlite.org/sqlite-wasm'
import {
  ArgsType,
  ParamsType,
  ResultType,
  SQLiteStatement,
  SqliteWrapper,
} from '.'

export const sqliteWasmWrapper = (sqlite: Database): SqliteWrapper => ({
  exec(sql: string) {
    sqlite.exec(sql)
    return Promise.resolve()
  },

  async transaction<T>(fn: (tx: SqliteWrapper) => T | Promise<T>): Promise<T> {
    try {
      sqlite.exec(`BEGIN TRANSACTION`)
      const result = await fn(this)
      sqlite.exec(`COMMIT`)
      return result
    } catch (error) {
      sqlite.exec(`ROLLBACK`)
      throw error
    }
  },

  prepare<P extends ParamsType>(sql: string): SQLiteStatement<P> {
    const stmt = sqlite.prepare(sql)

    return {
      run: (...params) => {
        try {
          if (params.length > 1) {
            for (let i = 0; i < params.length; i++) {
              stmt.bind(i + 1, params[i] as SqlValue)
            }
          } else if (params.length === 1) {
            stmt.bind(params[0] as SqlValue)
          }
          stmt.step()
          return Promise.resolve()
        } finally {
          stmt.reset()
        }
      },

      get<R extends ResultType>(...params: ArgsType<P>) {
        try {
          if (params.length > 1) {
            for (let i = 0; i < params.length; i++) {
              stmt.bind(i + 1, params[i] as SqlValue)
            }
          } else if (params.length === 1) {
            stmt.bind(params[0] as SqlValue)
          }

          const res = stmt.step() ? (stmt.get({}) as R) : undefined
          return Promise.resolve(res)
        } finally {
          stmt.reset()
        }
      },

      all<R extends ResultType>(...params: ArgsType<P>) {
        try {
          if (params.length > 1) {
            for (let i = 0; i < params.length; i++) {
              stmt.bind(i + 1, params[i] as SqlValue)
            }
          } else if (params.length === 1) {
            stmt.bind(params[0] as SqlValue)
          }

          const results: R[] = []
          while (stmt.step()) {
            results.push(stmt.get({}) as R)
          }
          return Promise.resolve(results)
        } finally {
          stmt.reset()
        }
      },

      finalize() {
        return stmt.finalize()
      },
    }
  },

  close() {
    sqlite.close()
  },
})
