import { capSQLiteSet, capSQLiteChanges, DBSQLiteValues } from '@capacitor-community/sqlite'
import { DbName, Row } from '../../util/types'
import { Database } from './database'

export class MockDatabase implements Database {
  dbname: DbName

  constructor(dbName: DbName) {
    this.dbname = dbName
  }

  executeSet(set: capSQLiteSet[], transaction?: boolean | undefined, returnMode?: string | undefined, isSQL92?: boolean | undefined): Promise<capSQLiteChanges> {
    return new Promise<capSQLiteChanges>( (resolve, reject) => {
      resolve({ changes: {changes: set.length}});
    }); 
  }
  query(statement: string, values?: any[] | undefined, isSQL92?: boolean | undefined): Promise<DBSQLiteValues> {
    return new Promise<DBSQLiteValues>( (resolve, reject) => {
      resolve({values: [{i: 0}]});
    }); 
  }
  run(statement: string, values?: any[] | undefined, transaction?: boolean | undefined, returnMode?: string | undefined, isSQL92?: boolean | undefined): Promise<capSQLiteChanges> {
    return new Promise<capSQLiteChanges>( (resolve, reject) => {
      resolve({ changes: {changes: 1}});
    }); 
  }
  beginTransaction(): Promise<capSQLiteChanges> {
    return new Promise<capSQLiteChanges>( (resolve, reject) => {
      resolve({ changes: {changes: 0}});
    }); 
  }
  commitTransaction(): Promise<capSQLiteChanges> {
    return new Promise<capSQLiteChanges>( (resolve, reject) => {
      resolve({ changes: {changes: 0}});
    }); 
  }
  rollbackTransaction(): Promise<capSQLiteChanges> {
    return new Promise<capSQLiteChanges>( (resolve, reject) => {
      resolve({ changes: {changes: 0}});
    }); 
  }
}
