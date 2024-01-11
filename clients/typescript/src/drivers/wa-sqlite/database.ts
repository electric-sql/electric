// Import the asynchronous WASM build because we will be using IndexedDB
// which is an async Virtual File System (VFS).
import SQLiteAsyncESMFactory from 'wa-sqlite/dist/wa-sqlite-async.mjs'

import * as SQLite from 'wa-sqlite'

// This is the recommended IndexedDB VFS
// It is preferable over OPFS because OPFS works only in a worker
// and is not yet supported on all browsers
// see: https://github.com/rhashimoto/wa-sqlite/tree/master/src/examples
import { IDBBatchAtomicVFS } from 'wa-sqlite/src/examples/IDBBatchAtomicVFS.js'

import { SqlValue, Statement } from '../../util'
import { Row } from '../../util/types'

import { Mutex } from 'async-mutex'
import { resultToRows } from '../util/results'

export type Database = Pick<
  ElectricDatabase,
  'name' | 'exec' | 'getRowsModified'
>

export class ElectricDatabase {
  #mutex: Mutex

  // Do not use this constructor directly.
  // Create a Database instance using the static `init` method instead.
  private constructor(
    public name: string,
    private sqlite3: SQLiteAPI,
    private db: number
  ) {
    this.#mutex = new Mutex()
  }

  async exec(statement: Statement): Promise<Row[]> {
    // Uses a mutex to ensure that the execution of SQL statements is not interleaved
    // otherwise wa-sqlite may encounter problems such as indices going out of bounds
    // all calls to wa-sqlite need to be coordinated through this mutex
    const release = await this.#mutex.acquire()
    try {
      // Need to wrap all sqlite statements in a try..finally block
      // that releases the lock at the very end, even if an error occurs
      return await this.execSql(statement)
    } finally {
      release()
    }
  }

  // Calls to this method must always be coordinated through the mutex
  private async execSql(statement: Statement): Promise<Row[]> {
    // `statements` is a convenience function that manages statement compilation
    // such that we don't have to prepare and finalize statements ourselves
    // cf. https://rhashimoto.github.io/wa-sqlite/docs/interfaces/SQLiteAPI.html#statements
    for await (const stmt of this.sqlite3.statements(this.db, statement.sql)) {
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
      const res = {
        columns: cols,
        values: rows,
      }
      return resultToRows(res) // exit loop after one statement
    }
    return [] // will get here only if there is no statement
  }

  getRowsModified() {
    return this.sqlite3.changes(this.db)
  }

  // Creates and opens a DB backed by an IndexedDB filesystem
  static async init(
    dbName: string,
    locateSqliteDist?: string | ((path: string) => string)
  ) {
    // Initialize SQLite
    const locateFile =
      typeof locateSqliteDist === 'string'
        ? (path: string) => {
            return locateSqliteDist + path
          }
        : locateSqliteDist

    const SQLiteAsyncModule = await SQLiteAsyncESMFactory({ locateFile })

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

    return new ElectricDatabase(dbName, sqlite3, db)
  }
}
