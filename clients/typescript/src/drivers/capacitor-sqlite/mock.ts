import { capSQLiteSet, capSQLiteChanges, DBSQLiteValues } from '@capacitor-community/sqlite'
import { DbName } from '../../util/types'
import { Database } from './database'

export class MockDatabase implements Database {
  dbname: DbName;
  fail: Error | undefined;

  constructor(dbName: DbName, fail?: Error) {
    this.dbname = dbName;
    this.fail = fail;
  }

  executeSet(set: capSQLiteSet[], transaction?: boolean | undefined, returnMode?: string | undefined, isSQL92?: boolean | undefined): Promise<capSQLiteChanges> {
    if (typeof this.fail !== 'undefined') throw this.fail;

    return new Promise<capSQLiteChanges>( (resolve, reject) => {
      resolve({ changes: {changes: 0}});
    }); 
  }
  query(statement: string, values?: any[] | undefined, isSQL92?: boolean | undefined): Promise<DBSQLiteValues> {
    if (typeof this.fail !== 'undefined') throw this.fail;

    return new Promise<DBSQLiteValues>( (resolve, reject) => {
      resolve({values: 
        [
          {textColumn: 'text1', numberColumn: 1},
          {textColumn: 'text2', numberColumn: 2}
        ]});
    }); 
  }
  run(statement: string, values?: any[] | undefined, transaction?: boolean | undefined, returnMode?: string | undefined, isSQL92?: boolean | undefined): Promise<capSQLiteChanges> {
    if (typeof this.fail !== 'undefined') throw this.fail;

    return new Promise<capSQLiteChanges>( (resolve, reject) => {
      resolve({ changes: {changes: 0}});
    }); 
  }
  beginTransaction(): Promise<capSQLiteChanges> {
    if (typeof this.fail !== 'undefined') throw this.fail;

    return new Promise<capSQLiteChanges>( (resolve, reject) => {
      resolve({ changes: {changes: 0}});
    }); 
  }
  commitTransaction(): Promise<capSQLiteChanges> {
    if (typeof this.fail !== 'undefined') throw this.fail;

    return new Promise<capSQLiteChanges>( (resolve, reject) => {
      resolve({ changes: {changes: 0}});
    }); 
  }
  rollbackTransaction(): Promise<capSQLiteChanges> {
    if (typeof this.fail !== 'undefined') throw this.fail;
    
    return new Promise<capSQLiteChanges>( (resolve, reject) => {
      resolve({ changes: {changes: 0}});
    }); 
  }
}
