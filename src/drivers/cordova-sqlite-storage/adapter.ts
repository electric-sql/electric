import { DatabaseAdapter as DatabaseAdapterInterface } from '../../electric/adapter'
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
