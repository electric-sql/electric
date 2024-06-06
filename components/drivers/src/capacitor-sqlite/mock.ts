import { DBSQLiteValues, capSQLiteChanges } from '@capacitor-community/sqlite'
import { DbName } from '../util/types.js'
import { Database } from './database.js'

export class MockDatabase implements Database {
  constructor(public dbname: DbName, public fail?: Error) {}

  executeSet(): Promise<capSQLiteChanges> {
    return this.resolveIfNotFail({ changes: { changes: 0 } })
  }

  run(): Promise<capSQLiteChanges> {
    return this.resolveIfNotFail({
      changes: {
        changes: 0,
      },
    })
  }

  execute(): Promise<capSQLiteChanges> {
    return this.run()
  }

  query(): Promise<DBSQLiteValues> {
    return this.resolveIfNotFail({
      values: [
        { textColumn: 'text1', numberColumn: 1 },
        { textColumn: 'text2', numberColumn: 2 },
      ],
    })
  }

  private resolveIfNotFail<T>(value: T): Promise<T> {
    if (typeof this.fail !== 'undefined') return Promise.reject(this.fail)
    else return Promise.resolve(value)
  }
}
