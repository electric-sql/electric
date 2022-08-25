import { Notifier } from '../../notifiers'
import { EmitNotifier } from '../../notifiers/node'

import { hasPublicKey, publicKeys } from '../../util/keys'
import { isPotentiallyDangerous } from '../../util/parser'

// The relevant subset of the Better-SQLite3 database client
// that we need to ensure the client we're electrifying provides.
export interface Database {
  name: string
  inTransaction: boolean

  exec(sql: string): Database
  prepare(sql: string): Statement
  transaction(fn: (...args: any[]) => any): (...args: any[]) => any
}

export interface Info {
  changes: number
  lastInsertRowid: number
}
export type BindParams = any[] | object
export type Row = object

// The relevant subset of the Better-SQLite3 prepared statement.
export interface Statement {
  database: Database
  readonly: boolean

  run(bindParams: BindParams): Info
  get(bindParams: BindParams): Row | void
  all(bindParams: BindParams): Row[]
  iterate(bindParams: BindParams): Iterable<Row>
}

type Original = Database | Statement

// The common interface our Electric wrappers must provide.
export interface Electric {
  electric: Notifier

  _setOriginal(original: Original): void
  _getOriginal(): Original
}

// `CallableTransaction` wraps the `txFn` returned from `db.transaction(fn)`
// so we can call `notifier.notifyCommit()` after the transaction executes --
// be it directly, or via the `deferred`, `immediate`, or `exclusive` methods.
//
// See https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#transactionfunction---function
class CallableTransaction extends Function {
  txFn: any
  notifier: Notifier

  constructor(txFn, notifier) {
    super()

    this.txFn = txFn
    this.notifier = notifier

    return new Proxy(this, {
      apply: (target, thisArg, args) => target._call(...args)
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

// Wrap the database client to automaticallly notify on commit.
export class ElectricDatabase implements Electric {
  // Private properties are not exposed via the proxy.
  _db: Database

  // This is the one public property we add to the underlying
  // Database client. Hence calling it our specific name, rather
  // than `notifier` as this way we're less likely to clobber
  // some existing property + allowing the user to manually
  // run `db.electric.notifyCommit()`.
  electric: Notifier

  constructor(db: Database, notifier: Notifier) {
    this._db = db
    this.electric = notifier
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

    return proxy(stmt, electric)
  }

  transaction(fn: (...args: any[]) => any): CallableTransaction {
    const txFn = this._db.transaction(fn)
    const notifier = this.electric

    return new CallableTransaction(txFn, notifier)
  }
}

// Wrap prepared statements to automaticallly notify on write
// when executed outside of a transaction.
export class ElectricStatement implements Electric {
  _stmt: Statement
  electric: Notifier

  constructor(stmt: Statement, notifier: Notifier) {
    this._stmt = stmt
    this.electric = notifier
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

// Proxy the original, intercepting the properties and methods that
// need to be patched to make the auto coommit notifications work.
//
// See https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy
// and https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Reflect
// for background on the proxy voodoo.
function proxy(original: Database, electric: ElectricDatabase): any;
function proxy(original: Statement, electric: ElectricStatement): any;
function proxy(original: Original, electric: any): any {
  return new Proxy(original, {
    has(target, key) {
      return Reflect.has(target, key) || hasPublicKey(electric, key)
    },
    ownKeys(target) {
      return Reflect.ownKeys(target).concat(publicKeys(electric));
    },
    getOwnPropertyDescriptor(target, key) {
      if (hasPublicKey(electric, key)) {
        return Reflect.getOwnPropertyDescriptor(electric, key)
      }

      return Reflect.getOwnPropertyDescriptor(target, key)
    },
    get(target, key, _receiver) {
      let value

      if (hasPublicKey(electric, key)) {
        value = electric[key]

        if (typeof value === 'function') {
          return (...args: any) => {
            const retval = Reflect.apply(value, electric, args)

            // Preserve chainability.
            if (retval.constructor === electric.constructor) {
              return proxy(retval._getOriginal(), retval)
            }

            return retval
          }
        }

        return value
      }

      value = target[key]

      if (typeof value === 'function') {
        return (...args: any) => {
          const retval = Reflect.apply(value, target, args)

          // Preserve chainability.
          if (retval.constructor === target.constructor) {
            electric._setOriginal(retval)

            return proxy(retval, electric)
          }

          return retval
        }
      }

      return value
    }
  })
}

export const electrify = (db: Database, notifier?: Notifier): Database => {
  if (!notifier) {
    notifier = new EmitNotifier(db.name)
  }
  const electric = new ElectricDatabase(db, notifier)

  return proxy(db, electric)
}
