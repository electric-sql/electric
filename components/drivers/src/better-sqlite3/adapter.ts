import { Mutex } from 'async-mutex'
import {
  DatabaseAdapter as DatabaseAdapterInterface,
  RunResult,
  TableNameImpl,
  Transaction as Tx,
  UncoordinatedDatabaseAdapter,
} from '../adapter.js'

import {
  Statement as DbStatement,
  Row,
  Statement,
  BindParams,
} from '../util/types.js'

import { Database, StatementBindParams } from './database.js'

export class DatabaseAdapter
  extends TableNameImpl
  implements DatabaseAdapterInterface
{
  db: Database
  readonly defaultNamespace = 'main'

  /*
   * Even though this driver is synchronous we need to coordinate the calls through a mutex
   * because of the `group` method which takes a function: `f: (adapter: UncoordinatedDatabaseAdapter) => Promise<void> | void`
   * that function may call `await` which would open the possibility for another query/transaction
   * to be interleaved with the execution of that function
   */
  protected txMutex: Mutex

  constructor(db: Database) {
    super()
    this.db = db
    this.txMutex = new Mutex()
  }

  async _runInTransaction(...statements: DbStatement[]): Promise<RunResult> {
    const txn = this.db.transaction((stmts: DbStatement[]) => {
      let rowsAffected = 0
      for (const stmt of stmts) {
        const prep = this.db.prepare(stmt.sql)
        const res = prep.run(...wrapBindParams(stmt.args))
        rowsAffected += res.changes // increment by the total number of rows that were inserted, updated, or deleted by this operation
      }
      return {
        rowsAffected: rowsAffected,
      }
    })
    return txn(statements)
  }

  async _transaction<T>(
    f: (_tx: Tx, setResult: (res: T) => void) => void
  ): Promise<T> {
    let result: T
    const txn = this.db.transaction(f)
    txn(new WrappedTx(this.db), (res) => (result = res))
    return result!
  }

  // Promise interface, but impl not actually async
  async _run({ sql, args }: DbStatement): Promise<RunResult> {
    const prep = this.db.prepare(sql)
    const res = prep.run(...wrapBindParams(args))
    return {
      rowsAffected: res.changes,
    }
  }

  // This `query` function does not enforce that the query is read-only
  async _query({ sql, args }: DbStatement): Promise<Row[]> {
    const stmt = this.db.prepare(sql)
    return stmt.all(...wrapBindParams(args)) as Row[]
  }

  async _runExclusively<T>(
    f: (adapter: UncoordinatedDatabaseAdapter) => Promise<T> | T
  ): Promise<T> {
    // We create an adapter that does not go through the mutex
    // when used by the function`f`, since we already take the mutex here
    const adapter = {
      run: this._run.bind(this),
      query: this._query.bind(this),
      transaction: this._transaction.bind(this),
      runInTransaction: this._runInTransaction.bind(this),
    }
    return f(adapter)
  }

  async runInTransaction(...statements: DbStatement[]): Promise<RunResult> {
    return this.txMutex.runExclusive(() => {
      return this._runInTransaction(...statements)
    })
  }

  async transaction<T>(
    f: (_tx: Tx, setResult: (res: T) => void) => void
  ): Promise<T> {
    return this.txMutex.runExclusive(() => {
      return this._transaction(f)
    })
  }

  async run(stmt: Statement): Promise<RunResult> {
    return this.txMutex.runExclusive(() => {
      return this._run(stmt)
    })
  }

  async query(stmt: Statement): Promise<Row[]> {
    return this.txMutex.runExclusive(() => {
      return this._query(stmt)
    })
  }

  async runExclusively<T>(
    f: (adapter: UncoordinatedDatabaseAdapter) => Promise<T> | T
  ): Promise<T> {
    return this.txMutex.runExclusive(() => {
      return this._runExclusively(f)
    })
  }
}

function wrapBindParams(x: BindParams | undefined): StatementBindParams {
  if (x && Array.isArray(x)) {
    return x
  } else if (x) {
    return [x]
  } else {
    return []
  }
}

class WrappedTx implements Tx {
  constructor(private db: Database) {}

  run(
    { sql, args }: Statement,
    successCallback?: (tx: WrappedTx, res: RunResult) => void,
    errorCallback?: (error: any) => void
  ): void {
    try {
      const prep = this.db.prepare(sql)
      const res = prep.run(...wrapBindParams(args))
      if (typeof successCallback !== 'undefined')
        successCallback(this, { rowsAffected: res.changes })
    } catch (err) {
      if (typeof errorCallback !== 'undefined') errorCallback(err)
      throw err // makes the transaction fail (needed to have consistent behavior with react-native and expo drivers which also fail if one of the statements fail)
    }
  }

  query(
    { sql, args }: Statement,
    successCallback: (tx: WrappedTx, res: Row[]) => void,
    errorCallback?: (error: any) => void
  ): void {
    try {
      const stmt = this.db.prepare(sql)
      const rows = stmt.all(...wrapBindParams(args)) as Row[]
      successCallback(this, rows)
    } catch (err) {
      if (typeof errorCallback !== 'undefined') errorCallback(err)
      throw err // makes the transaction fail (needed to have consistent behavior with react-native and expo drivers which also fail if one of the statements fail)
    }
  }
}
