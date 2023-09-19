console.log("Trace: We are in the sqlx driver");

(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

// Import the asynchronous WASM build because we will be using IndexedDB
// which is an async Virtual File System (VFS).
import SQLiteAsyncESMFactory from 'wa-sqlite/dist/wa-sqlite-async.mjs'

import * as SQLite from 'wa-sqlite'

// This is the recommended IndexedDB VFS
// It is preferable over OPFS because OPFS works only in a worker
// and is not yet supported on all browsers
// see: https://github.com/rhashimoto/wa-sqlite/tree/master/src/examples
import { IDBBatchAtomicVFS } from 'wa-sqlite/src/examples/IDBBatchAtomicVFS.js'

// import { invoke } from '@tauri-apps/api'

import { SqlValue, Statement } from '../../util'
import { QueryExecResult } from '../util/results'

import { Mutex } from 'async-mutex'

const emptyResult = {
  columns: [],
  values: [],
}

function objectToArrays(obj: { [key: string]: SqlValue }): [string[], SqlValue[]] {
  const keys = Object.keys(obj);
  const values = keys.map(key => obj[key]);
  return [keys, values];
}

export interface Database {
  name: string
  exec(statement: Statement): Promise<QueryExecResult>
  getRowsModified(): number
}

export class ElectricDatabase implements Database {
  mutex: Mutex

  // Do not use this constructor directly.
  // Create a Database instance using the static `init` method instead.
  private constructor(
    public name: string,
    private sqlite3: SQLiteAPI,
    // private sqlx: <T>(name: string, data: object) => Promise<T>,
    private invoke: Function,
    private db: number
  ) {
    this.mutex = new Mutex()
  }

  async test_tauri(name: SqlValue) {
    this.invoke("test_tauri", { name });
  }

  async tauri_init(name: string) {
    this.invoke("tauri_init", { name });
  }

  async tauri_exec(statement: Statement) {

    let keys: string[] = [];
    let values: SqlValue[] = [];

    if (typeof statement.args === 'undefined') {
      values = []; // If undefined, we just send an empty array, the same as if the array was empty before-hand.
    } else {
      // If we have object, we have Row, so get the keys
      if (Array.isArray(statement.args)) {
        values = statement.args;
        keys = [];
      } else {
        [keys, values] = objectToArrays(statement.args);
      }
    }

    this.invoke("tauri_exec_command", { sql: statement.sql , bind_params: { keys, values } });
  }

  async exec(statement: Statement): Promise<QueryExecResult> {
    console.log("Trace: exec called with ", statement)
    await this.test_tauri(1);

    await this.tauri_exec(statement);

    // Uses a mutex to ensure that the execution of SQL statements is not interleaved
    // otherwise wa-sqlite may encounter problems such as indices going out of bounds
    const release = await this.mutex.acquire()

    const str = this.sqlite3.str_new(this.db, statement.sql)
    let prepared
    try {
      prepared = await this.sqlite3.prepare_v2(
        this.db,
        this.sqlite3.str_value(str)
      )
    } finally {
      release()
    }

    if (prepared === null) {
      release()
      return emptyResult
    }

    const stmt = prepared.stmt
    try {
      if (typeof statement.args !== 'undefined') {
        this.sqlite3.bind_collection(
          stmt,
          statement.args as
            | { [index: string]: SQLiteCompatibleType }
            | SQLiteCompatibleType[]
        )
      }

      const rows: SqlValue[][] = []
      let cols: string[] = []

      while ((await this.sqlite3.step(stmt)) === SQLite.SQLITE_ROW) {
        cols = cols.length === 0 ? this.sqlite3.column_names(stmt) : cols
        const row = this.sqlite3.row(stmt) as SqlValue[]
        rows.push(row)
      }

      return {
        columns: cols,
        values: rows,
      }
    } finally {
      await this.sqlite3.finalize(stmt)
      release()
    }
  }

  getRowsModified() {
    this.invoke("tauri_getRowsModified");
    return this.sqlite3.changes(this.db)
  }

  // Creates and opens a DB backed by an IndexedDB filesystem
  static async init(dbName: string, sqliteDistPath: string, invoke: Function) {
    // Initialize SQLite
    console.log("JSTrace: init", dbName, sqliteDistPath)
    let result = invoke("my_tauri_init", { name: dbName });
    result.await;
    console.log(result);

    const SQLiteAsyncModule = await SQLiteAsyncESMFactory({
      locateFile: (path: string) => {
        return sqliteDistPath + path
      },
    })

    // Build API objects for the module
    const sqlite3 = SQLite.Factory(SQLiteAsyncModule)

    // Register a Virtual File System with the SQLite runtime
    sqlite3.vfs_register(new IDBBatchAtomicVFS(dbName))

    // Open the DB connection
    // see: https://rhashimoto.github.io/wa-sqlite/docs/interfaces/SQLiteAPI.html#open_v2
    const db = await sqlite3.open_v2(
      dbName,
      SQLite.SQLITE_OPEN_CREATE | SQLite.SQLITE_OPEN_READWRITE,
      dbName
    )

    return new ElectricDatabase(dbName, sqlite3, invoke, db)
  }
}
