import { capSQLiteChanges, DBSQLiteValues } from '@capacitor-community/sqlite'
import { DbName } from '../../util/types'
import { Database } from './database'

export class MockDatabase implements Database {
  dbname: DbName
  fail: Error | undefined

  constructor(dbName: DbName, fail?: Error) {
    this.dbname = dbName
    this.fail = fail
  }

  executeSet(): Promise<capSQLiteChanges> {
    return new Promise<capSQLiteChanges>((resolve, reject) => {
      if (typeof this.fail !== 'undefined') reject(this.fail)
      resolve({ changes: { changes: 0 } })
    })
  }
  query(): Promise<DBSQLiteValues> {
    return new Promise<DBSQLiteValues>((resolve, reject) => {
      if (typeof this.fail !== 'undefined') reject(this.fail)
      resolve({
        values: [
          { textColumn: 'text1', numberColumn: 1 },
          { textColumn: 'text2', numberColumn: 2 },
        ],
      })
    })
  }
  run(): Promise<capSQLiteChanges> {
    return new Promise<capSQLiteChanges>((resolve, reject) => {
      if (typeof this.fail !== 'undefined') reject(this.fail)
      resolve({ changes: { changes: 0 } })
    })
  }
  beginTransaction(): Promise<capSQLiteChanges> {
    return new Promise<capSQLiteChanges>((resolve, reject) => {
      if (typeof this.fail !== 'undefined') reject(this.fail)
      resolve({ changes: { changes: 0 } })
    })
  }
  commitTransaction(): Promise<capSQLiteChanges> {
    return new Promise<capSQLiteChanges>((resolve, reject) => {
      if (typeof this.fail !== 'undefined') reject(this.fail)
      resolve({ changes: { changes: 0 } })
    })
  }
  rollbackTransaction(): Promise<capSQLiteChanges> {
    return new Promise<capSQLiteChanges>((resolve, reject) => {
      if (typeof this.fail !== 'undefined') reject(this.fail)
      resolve({ changes: { changes: 0 } })
    })
  }
}
