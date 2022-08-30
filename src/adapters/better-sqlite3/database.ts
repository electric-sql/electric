import { ElectricNamespace } from '../../electric/index'
import { CommitNotifier } from '../../notifiers/index'
import { ProxyWrapper, proxyOriginal } from '../../proxy/index'
import { isPotentiallyDangerous } from '../../util/parser'
import { BindParams, DbName, Row } from '../../util/types'

// The relevant subset of the Better-SQLite3 database client
// that we need to ensure the client we're electrifying provides.
export interface Database {
  name: DbName
  inTransaction: boolean

  exec(sql: string): Database
  prepare(sql: string): Statement
  transaction(fn: (...args: any[]) => any): (...args: any[]) => any
}

export interface Info {
  changes: number
  lastInsertRowid: number
}

// The relevant subset of the Better-SQLite3 prepared statement.
export interface Statement {
  database: Database
  readonly: boolean
  source: string

  run(bindParams: BindParams): Info
  get(bindParams: BindParams): Row | void
  all(bindParams: BindParams): Row[]
  iterate(bindParams: BindParams): Iterable<Row>
}

// `CallableTransaction` wraps the `txFn` returned from `db.transaction(fn)`
// so we can call `notifier.notifyCommit()` after the transaction executes --
// be it directly, or via the `deferred`, `immediate`, or `exclusive` methods.
//
// See https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#transactionfunction---function
class CallableTransaction extends Function {
  txFn: any
  notifier: CommitNotifier

  constructor(txFn: (...args: any[]) => any, notifier: CommitNotifier) {
    super()

    this.txFn = txFn
    this.notifier = notifier

    return new Proxy(this, {
      apply: (target, _thisArg, args) => target._call(...args)
    })
  }

  _call(...args: any[]): any {
    const retval = this.txFn(...args)

    this.notifyCommit()

    return retval
  }

  deferred(...args: any[]): any {
    const retval = this.txFn.deferred(...args)

    this.notifyCommit()

    return retval
  }

  immediate(...args: any[]): any {
    const retval = this.txFn.immediate(...args)

    this.notifyCommit()

    return retval
  }

  exclusive(...args: any[]): any {
    const retval = this.txFn.exclusive(...args)

    this.notifyCommit()

    return retval
  }

  notifyCommit() {
    this.notifier.notifyCommit()
  }
}

// Wrap the database client to automatically notify on commit.
export class ElectricDatabase implements ProxyWrapper {
  // Private properties are not exposed via the proxy.
  _db: Database

  // The public property we add to the underlying Database client,
  electric: ElectricNamespace

  constructor(db: Database, namespace: ElectricNamespace) {
    this._db = db
    this.electric = namespace
  }

  // Used when re-proxying so the proxy code doesn't need
  // to know the property name.
  _setOriginal(db: Database): void {
    this._db = db
  }
  _getOriginal(): Database {
    return this._db
  }

  exec(sql: string): ElectricDatabase {
    const shouldNotify = isPotentiallyDangerous(sql)

    this._db.exec(sql)

    if (shouldNotify) {
      this.electric.notifyCommit()
    }

    return this
  }

  prepare(sql: string): Statement {
    const stmt = this._db.prepare(sql)
    const electric = new ElectricStatement(stmt, this.electric)

    return proxyOriginal(stmt, electric)
  }

  transaction(fn: (...args: any[]) => any): CallableTransaction {
    const txFn = this._db.transaction(fn)
    const notifier = this.electric.notifier

    return new CallableTransaction(txFn, notifier)
  }
}

// Wrap prepared statements to automatically notify on write
// when executed outside of a transaction.
export class ElectricStatement implements ProxyWrapper {
  _stmt: Statement
  electric: ElectricNamespace

  constructor(stmt: Statement, electric: ElectricNamespace) {
    this._stmt = stmt
    this.electric = electric
  }

  _setOriginal(stmt: Statement): void {
    this._stmt = stmt
  }
  _getOriginal(): Statement {
    return this._stmt
  }

  _shouldNotify() {
    return !this._stmt.readonly
        && !this._stmt.database.inTransaction
  }

  run(bindParams: BindParams): Info {
    const shouldNotify = this._shouldNotify()
    const info = this._stmt.run(bindParams)

    if (shouldNotify) {
      this.electric.notifyCommit()
    }

    return info
  }

  get(bindParams: BindParams): Row | void {
    const shouldNotify = this._shouldNotify()
    const row = this._stmt.get(bindParams)

    if (shouldNotify) {
      this.electric.notifyCommit()
    }

    return row
  }

  all(bindParams: BindParams): Row[] {
    const shouldNotify = this._shouldNotify()
    const rows = this._stmt.all(bindParams)

    if (shouldNotify) {
      this.electric.notifyCommit()
    }

    return rows
  }

  iterate(bindParams: BindParams): IterableIterator<Row> {
    const shouldNotify = this._shouldNotify()
    const notifyCommit = this.electric.notifyCommit.bind(this.electric)

    const iterRows = this._stmt.iterate(bindParams)

    function *generator(): IterableIterator<Row> {
      try {
        for (const row of iterRows) {
          yield row
        }
      }
      finally {
        if (shouldNotify) {
          notifyCommit()
        }
      }
    }

    return generator()
  }
}

export const proxy = (db: Database, namespace: ElectricNamespace): Database => {
  const electric = new ElectricDatabase(db, namespace)

  return proxyOriginal(db, electric)
}
