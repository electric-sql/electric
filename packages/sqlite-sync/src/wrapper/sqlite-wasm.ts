import { Database, SqlValue } from '@sqlite.org/sqlite-wasm'
import {
  ArgsType,
  ParamsType,
  ResultType,
  SQLiteStatement,
  SqliteWrapper,
} from '.'

export const sqliteWasmWrapper = (sqlite: Database): SqliteWrapper => ({
  exec: <T extends { [column: string]: SqlValue }>(sql: string) => {
    const res = sqlite.selectValue(sql) as T | undefined
    return Promise.resolve(res)
  },

  transaction: async <T>(fn: (db: SqliteWrapper) => Promise<T>): Promise<T> =>
    sqlite.transaction(async () => fn(sqliteWasmWrapper(sqlite))),

  prepare: <P extends ParamsType>(sql: string): SQLiteStatement<P> => {
    const stmt = sqlite.prepare(sql)

    return {
      run: (...params) => {
        if (params.length > 1) {
          for (let i = 0; i < params.length; i++) {
            stmt.bind(i + 1, params[i] as SqlValue)
          }
        } else if (params.length === 1) {
          stmt.bind(params[0] as SqlValue)
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
          stmt.bind(params[0] as SqlValue)
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
          stmt.bind(params[0] as SqlValue)
        }

        const results: R[] = []
        while (stmt.step()) {
          results.push(stmt.get({}) as R)
        }
        return Promise.resolve(results)
      },

      finalize: () => stmt.finalize(),
    }
  },

  close: () => sqlite.close(),
})
