import { DbName } from '../../util/types'
import { SQLitePlugin, SQLitePluginTransaction } from './index'

export abstract class MockSQLitePlugin implements SQLitePlugin {
  databaseFeatures: {
    isSQLitePluginDatabase: true
  }
  openDBs: {
    [key: DbName]: 'INIT' | 'OPEN'
  }

  constructor(dbName: DbName) {
    this.databaseFeatures = {
      isSQLitePluginDatabase: true
    }
    this.openDBs = {}
    this.openDBs[dbName] = 'OPEN'
  }

  addTransaction(tx: SQLitePluginTransaction): void {
    if (!!tx.success) {
      tx.success('mocked!')
    }
  }
}

export class MockSQLitePluginTransaction implements SQLitePluginTransaction {
  readOnly: boolean

  constructor(readOnly: boolean = false) {
    this.readOnly = readOnly
  }

  success(..._args: any[]): void {}
}
