import { DbName } from '../../util/types'
import { Database, Transaction } from './index'

export class MockDatabase implements Database {
  dbName: DbName

  databaseFeatures: {
    isSQLitePluginDatabase: true
  }
  openDBs: {
    [key: DbName]: 'INIT' | 'OPEN'
  }

  constructor(dbName: DbName) {
    this.dbName = dbName

    this.databaseFeatures = {isSQLitePluginDatabase: true}
    this.openDBs = {}
    this.openDBs[dbName] = 'OPEN'
  }

  addTransaction(tx: Transaction): void {
    if (!!tx.success) {
      tx.success()
    }
  }

  attach(_dbName: DbName, _dbAlias: DbName, success?: (...args: any[]) => any, _error?: (...args: any[]) => any): void {
    if (!!success) {
      success()
    }
  }

  detatch(_dbAlias: DbName, success?: (...args: any[]) => any, _error?: (...args: any[]) => any): void {
    if (!!success) {
      success()
    }
  }
}

export class MockTransaction implements Transaction {
  readOnly: boolean

  constructor(readOnly: boolean = false) {
    this.readOnly = readOnly
  }

  success(..._args: any[]): void {}
}
