import { ElectricNamespace } from '../../electric/index'
import { Notifier } from '../../notifiers/index'
import { ProxyWrapper, proxyOriginal } from '../../proxy/index'
import { isPotentiallyDangerous } from '../../util/parser'
import { BindParams, Row } from '../../util/types'
import type {
  Database as OriginalDatabase,
  Statement as OriginalStatement,
  Transaction,
  RunResult,
} from 'better-sqlite3'

export type { Transaction }

// The relevant subset of the Better-SQLite3 database client
// that we need to ensure the client we're electrifying provides.
export interface Database
  extends Pick<
    OriginalDatabase,
    'name' | 'inTransaction' | 'prepare' | 'transaction'
  > {
  exec(sql: string): this
}

export type StatementBindParams<T = BindParams> = T extends any[] ? T : [T]

// The relevant subset of the Better-SQLite3 prepared statement.
type BoundStatement<T extends any[]> = Omit<
  OriginalStatement<T>,
  'run' | 'get' | 'all' | 'iterate'
> & {
  run: (...params: T) => RunResult
  get: (...params: T) => Row | undefined
  all: (...params: T) => Row[]
  iterate: (...params: T) => IterableIterator<Row>
}

export type Statement<T extends BindParams = []> = T extends any[]
  ? BoundStatement<T>
  : BoundStatement<[T]>

type VariableArgFunction = (...args: any[]) => any

// `transactionWithNotifier` wraps the `txFn` returned from `db.transaction(fn)`
// so we can call `notifier.potentiallyChanged()` after the transaction executes --
// be it directly, or via the `deferred`, `immediate`, or `exclusive` methods.
//
// See https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#transactionfunction---function
const transactionWithNotifier = <T extends VariableArgFunction>(
  txFn: Transaction<T>,
  notifier: Notifier
): Transaction<T> => {
  const wrappedFn = <Transaction<T>>((...args: Parameters<T>) => {
    const originalReturn = txFn(...args)
    notifier.potentiallyChanged()
    return originalReturn
  })

  for (const property of [
    'default',
    'deferred',
    'immediate',
    'exclusive',
  ] as const) {
    wrappedFn[property] = (...args: Parameters<T>) => {
      const originalReturn = txFn[property](...args)
      notifier.potentiallyChanged()
      return originalReturn
    }
  }

  return wrappedFn
}

// Wrap the database client to automatically notify on commit.
export class ElectricDatabase implements ProxyWrapper, Database {
  // Private properties are not exposed via the proxy.
  _db: Database

  // The public property we add to the underlying Database client,
  electric: ElectricNamespace

  constructor(db: Database, namespace: ElectricNamespace) {
    this._db = db
    this.electric = namespace
  }

  public get name() {
    return this._db.name
  }
  public get inTransaction() {
    return this._db.inTransaction
  }

  // Used when re-proxying so the proxy code doesn't need
  // to know the property name.
  _setOriginal(db: Database): void {
    this._db = db
  }
  _getOriginal(): Database {
    return this._db
  }

  exec(sql: string): this {
    const shouldNotify = isPotentiallyDangerous(sql)

    this._db.exec(sql)

    if (shouldNotify) {
      this.electric.potentiallyChanged()
    }

    return this
  }

  prepare<T extends BindParams = []>(sql: string): Statement<T> {
    const stmt = this._db.prepare<T>(sql)
    const electric = new ElectricStatement(stmt, this.electric)

    return proxyOriginal(stmt, electric)
  }

  transaction<T extends VariableArgFunction>(fn: T): Transaction<T> {
    const txFn = this._db.transaction<T>(fn)
    const notifier = this.electric.notifier

    return transactionWithNotifier(txFn, notifier)
  }
}

// Wrap prepared statements to automatically notify on write
// when executed outside of a transaction.
export class ElectricStatement
  implements
    ProxyWrapper,
    Pick<OriginalStatement, 'run' | 'get' | 'all' | 'iterate'>
{
  _stmt: OriginalStatement
  electric: ElectricNamespace

  constructor(stmt: OriginalStatement, electric: ElectricNamespace) {
    this._stmt = stmt
    this.electric = electric
  }

  _setOriginal(stmt: OriginalStatement): void {
    this._stmt = stmt
  }
  _getOriginal(): OriginalStatement {
    return this._stmt
  }

  _shouldNotify() {
    return !this._stmt.readonly && !this._stmt.database.inTransaction
  }

  run(...bindParams: StatementBindParams): RunResult {
    const shouldNotify = this._shouldNotify()
    const info = this._stmt.run(...bindParams)

    if (shouldNotify) {
      this.electric.potentiallyChanged()
    }

    return info
  }

  get(...bindParams: StatementBindParams): Row | void {
    const shouldNotify = this._shouldNotify()
    const row = this._stmt.get(...bindParams)

    if (shouldNotify) {
      this.electric.potentiallyChanged()
    }

    return row
  }

  all(...bindParams: StatementBindParams): Row[] {
    const shouldNotify = this._shouldNotify()
    const rows = this._stmt.all(...bindParams)

    if (shouldNotify) {
      this.electric.potentiallyChanged()
    }

    return rows
  }

  iterate(...bindParams: StatementBindParams): IterableIterator<Row> {
    const shouldNotify = this._shouldNotify()
    const potentiallyChanged = this.electric.potentiallyChanged.bind(
      this.electric
    )

    const iterRows = this._stmt.iterate(...bindParams)

    function* generator(): IterableIterator<Row> {
      try {
        for (const row of iterRows) {
          yield row
        }
      } finally {
        if (shouldNotify) {
          potentiallyChanged()
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

type UnpatchedDatabase<T extends Database> = Omit<
  T,
  'exec' | 'prepare' | 'transaction'
>
export type ElectrifiedDatabase<T extends Database = Database> =
  UnpatchedDatabase<T> & ElectricDatabase
