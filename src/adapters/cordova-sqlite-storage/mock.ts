import { DbName } from '../../util/types'
import { MockSQLitePlugin } from '../sqlite-plugin/mock'
import { Database } from './index'

export class MockDatabase extends MockSQLitePlugin implements Database {
  dbname: DbName

  constructor(dbName: DbName) {
    super(dbName)

    this.dbname = dbName
  }
}
