import { capSQLiteChanges } from '@capacitor-community/sqlite'
import { DbName } from '../../util/types'
import { Database } from './database'

export class MockDatabase implements Database {
  constructor(public dbname: DbName, public fail?: Error) {}

  executeSet(): Promise<capSQLiteChanges> {
    return this.resolveIfNotFail({ changes: { changes: 0 } })
  }

  run(): Promise<capSQLiteChanges> {
    return this.resolveIfNotFail({
      changes: {
        changes: 0,
        values: [
          { textColumn: 'text1', numberColumn: 1 },
          { textColumn: 'text2', numberColumn: 2 },
        ],
      },
    })
  }

  query(): Promise<any> {
    throw new Error('Not implemented')
  }

  private resolveIfNotFail<T>(value: T): Promise<T> {
    if (typeof this.fail !== 'undefined') return Promise.reject(this.fail)
    else return Promise.resolve(value)
  }
}
