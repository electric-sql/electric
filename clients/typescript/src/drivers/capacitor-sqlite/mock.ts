import { capSQLiteChanges, DBSQLiteValues } from '@capacitor-community/sqlite'
import { DbName } from '../../util/types'
import { Database } from './database'

export class MockDatabase implements Database {

  constructor(public dbname: DbName, public fail?: Error) {}

  executeSet(): Promise<capSQLiteChanges> {
    return this.resolveIfNotFail({ changes: { changes: 0 } })
  }

  query(): Promise<DBSQLiteValues> {
    return this.resolveIfNotFail({
      values: [
        { textColumn: 'text1', numberColumn: 1 },
        { textColumn: 'text2', numberColumn: 2 }
      ]
    })
  }

  run(): Promise<capSQLiteChanges> {
    return this.resolveIfNotFail({ changes: { changes: 0 } })
  }
  beginTransaction(): Promise<capSQLiteChanges> {
    return this.resolveIfNotFail({ changes: { changes: 0 } })
  }
  commitTransaction(): Promise<capSQLiteChanges> {
    return this.resolveIfNotFail({ changes: { changes: 0 } })
  }
  rollbackTransaction(): Promise<capSQLiteChanges> {
    return this.resolveIfNotFail({ changes: { changes: 0 } })
  }

  private resolveIfNotFail<T>(value: T): Promise<T> {
    if (typeof this.fail !== 'undefined')
      return Promise.reject(this.fail)
    else 
      return Promise.resolve(value)
  }
}
