import { DbMethod, StatementMethod, WorkerClient } from '../../bridge/index'
import { ElectricNamespace } from '../../electric/index'
import { ProxyWrapper, proxyOriginal } from '../../proxy/index'
import { isPotentiallyDangerous } from '../../util/parser'
import { randomValue } from '../../util/random'
import {
  AnyFunction,
  BindParams,
  DbName,
  EmptyFunction,
  FunctionMap,
  Row,
  RowCallback,
  SqlValue
} from '../../util/types'

export interface Config {
  useBigInt?: boolean
}

export interface QueryExecResult {
  columns: string[],
  values: SqlValue[][]
}

// The SQL.js API that we need to proxy -- which in this case
// is basically the entire interface.
export interface Database {
  exec(sql: string, params?: BindParams, config?: Config): QueryExecResult[] | Promise<QueryExecResult[]>
  run(sql: string, params?: BindParams): Database | Promise<Database>
  prepare(sql: string, params?: BindParams): Statement | Promise<Statement>
  each?(sql: string, params: BindParams | RowCallback, callback: RowCallback | EmptyFunction, done?: EmptyFunction, config?: Config): Database | Promise<Database>
  iterateStatements?(sql: string): StatementIterator | Promise<StatementIterator>
  getRowsModified(): number | Promise<number>
  close(): void | Promise<void>
  export(): Uint8Array | Promise<Uint8Array>
  create_function(name: string, func?: AnyFunction | string): Database | Promise<Database>
}

export interface Statement {
  db: Database
  stmt: string

  bind(values: BindParams): boolean | Promise<boolean>
  step(): boolean | Promise<boolean>
  get(params?: BindParams, config?: Config): SqlValue[] | Promise<SqlValue[]>
  getColumnNames(): string[] | Promise<string[]>
  getAsObject(params?: BindParams, config?: Config): Row | Promise<Row>
  getSQL(): string | Promise<string>
  getNormalizedSQL(): string | Promise<string>
  run(values: BindParams): boolean | Promise<boolean>
  bindFromObject(valuesObj: Row): true | Promise<true>
  bindFromArray(values: SqlValue[]): true | Promise<true>
  reset(): boolean | Promise<boolean>
  free(): boolean | Promise<boolean>
}

export type StatementIterator = AsyncIterator<Statement>

// This is the primary wrapped database client that runs in the
// worker thread, using SQL.js with absurd-sql.
export class ElectricDatabase {
  db: Database
  electric: ElectricNamespace
  _statements: {
    [key: string]: Statement
  }
  _user_defined_functions: FunctionMap

  constructor(db: Database, namespace: ElectricNamespace, functions: FunctionMap = {}) {
    this.db = db
    this.electric = namespace

    this._statements = {}
    this._user_defined_functions = functions
  }

  _getStatement(key: string): Statement | undefined {
    return this._statements[key]
  }
  async _releaseStatement(key: string): Promise<void> {
    const statement = this._getStatement(key)

    if (statement === undefined) {
      return
    }

    statement.free()
    delete this._statements[key]
  }
  async _releaseStatements(keys: string[]): Promise<void> {
    await Promise.all(keys.map(key => this._releaseStatement(key)))
  }

  async exec(sql: string, params?: BindParams, config?: Config): Promise<QueryExecResult[]> {
    const shouldNotify = isPotentiallyDangerous(sql)

    const retval = await this.db.exec(sql, params, config)

    if (shouldNotify) {
      this.electric.potentiallyChanged()
    }

    return retval
  }
  async run(sql: string, params?: BindParams): Promise<void> {
    const shouldNotify = isPotentiallyDangerous(sql)

    await this.db.run(sql, params)

    if (shouldNotify) {
      this.electric.potentiallyChanged()
    }
  }
  async prepare(sql: string, params?: BindParams): Promise<string> {
    const key = randomValue()
    const stmt = await this.db.prepare(sql, params)

    const namespace = this.electric
    const shouldNotify = isPotentiallyDangerous(sql)
    const electric = new ElectricStatement(stmt, namespace, shouldNotify)

    this._statements[key] = proxyOriginal(stmt, electric)

    return key
  }
  async getRowsModified(): Promise<number> {
    return this.db.getRowsModified()
  }
  async close(): Promise<void> {
    await this.db.close()

    this._statements = {}
  }
  async export(): Promise<Uint8Array> {
    return this.db.export()
  }
  // N.b.: we can't pass functions to the worker, so any functions
  // need to be defined and hung off `self` in worker.js.
  async create_function(name: string, fnName?: string): Promise<boolean> {
    if (fnName === undefined) {
      fnName = name
    }

    const fn = this._user_defined_functions[fnName]

    if (fn !== undefined) {
      await this.db.create_function(name, fn)

      return true
    }

    return false
  }
}

// Wrap prepared statements to automatically notify on write.
//
// Ideally we would track when statements are being executed
// within a transaction. However, that's not naturally supported
// by the SQL.js interface and it's not yet implemented in these
// wrappers. Before implementing, we should really look at the
// multiple connection handler stuff in the browser and at
// implementing a transaction API that's safe for use from
// multiple components at the same time.
export class ElectricStatement implements ProxyWrapper {
  _hasNotified: boolean
  _isPotentiallyDangerous: boolean
  _stmt: Statement

  electric: ElectricNamespace

  constructor(stmt: Statement, electric: ElectricNamespace, isPotentiallyDangerous: boolean) {
    this._hasNotified = false
    this._isPotentiallyDangerous = isPotentiallyDangerous
    this._stmt = stmt
    this.electric = electric
  }

  _setOriginal(stmt: Statement): void {
    this._stmt = stmt
  }
  _getOriginal(): Statement {
    return this._stmt
  }

  _conditionallyNotifyCommit () {
    if (!this._isPotentiallyDangerous || this._hasNotified) {
      return
    }

    this.electric.potentiallyChanged()
    this._hasNotified = true
  }

  // Bind and reset also reset the notification gate.
  async bind(values: BindParams): Promise<boolean> {
    const result = await this._stmt.bind(values)

    this._hasNotified = false

    return result
  }
  async reset(): Promise<boolean> {
    const result = await this._stmt.reset()

    this._hasNotified = false

    return result
  }

  // Run and step always conditionally notify.
  async run(values: BindParams): Promise<boolean> {
    const result = await this._stmt.run(values)

    this._conditionallyNotifyCommit()

    return result
  }
  async step(): Promise<boolean> {
    const result = await this._stmt.step()

    this._conditionallyNotifyCommit()

    return result
  }

  // Get and getAsObject conditionally notify iff
  // params are provided.
  async get(params?: BindParams, config?: Config): Promise<SqlValue[]> {
    const result = await this._stmt.get(params, config)

    if (params !== undefined) {
      this._hasNotified = false

      this._conditionallyNotifyCommit()
    }

    return result
  }
  async getAsObject(params?: BindParams, config?: Config): Promise<Row> {
    const result = await this._stmt.getAsObject(params, config)

    if (params !== undefined) {
      this._hasNotified = false

      this._conditionallyNotifyCommit()
    }

    return result
  }
}

// This is the proxy client that runs in the main thread, using the
// workerClient to proxy method calls on to the ElectricDatabase in
// the worker thread.
export class MainThreadDatabaseProxy implements Database {
  _dbName: DbName
  _workerClient: WorkerClient
  _statements: {
    [key: string]: MainThreadStatementProxy
  }

  constructor(dbName: DbName, workerClient: WorkerClient) {
    this._dbName = dbName
    this._workerClient = workerClient
    this._statements = {}
  }

  _request(methodName: string, ...args: any[]): Promise<any> {
    const method: DbMethod = {
      target: 'db',
      dbName: this._dbName,
      name: methodName
    }

    return this._workerClient.request(method, ...args)
  }

  async _releaseStatement(id: string): Promise<void> {
    await this._request('_releaseStatement', id)

    delete this._statements[id]
  }

  exec(sql: string, params?: BindParams, config?: Config): Promise<QueryExecResult[]> {
    return this._request('exec', sql, params, config)
  }

  async run(sql: string, params?: BindParams): Promise<Database> {
    await this._request('run', sql, params)

    return this
  }
  async prepare(sql: string, params?: BindParams): Promise<Statement> {
    const id = await this._request('prepare', sql, params)
    const stmt = new MainThreadStatementProxy(id, sql, this, this._workerClient)

    this._statements[id] = stmt
    return stmt
  }
  async each(sql: string, params: BindParams | RowCallback, callback: RowCallback | EmptyFunction, done?: EmptyFunction, config?: Config): Promise<Database> {
    const shiftArgs = typeof params === 'function'

    const actualParams = (shiftArgs ? [] : params) as BindParams
    const actualCallback = (shiftArgs ? params : callback) as RowCallback
    const actualDone = (shiftArgs ? callback : done) as EmptyFunction

    const stmt = await this.prepare(sql, actualParams)

    let row: Row
    let hasRow: boolean

    try {
      while (true) {
        hasRow = await stmt.step()
        if (!hasRow) {
          break
        }

        row = await stmt.getAsObject(undefined, config)
        actualCallback(row)
      }
    }
    finally {
      stmt.free()
    }
    if (actualDone !== undefined) {
      actualDone()
    }

    return this
  }
  async *iterateStatements(sqlStatements: string): StatementIterator {
    const parts: string[] = sqlStatements
      .split(';')
      .filter(x => x && x.trim())

    const stmtIds: string[] = []

    let i: number
    let sql: string
    let stmt: MainThreadStatementProxy

    try {
      for (i = 0; i < parts.length; i++) {
        sql = parts[i]
        stmt = await this.prepare(sql) as MainThreadStatementProxy
        stmtIds.push(stmt._id)
        yield stmt
      }
    }
    finally {
      if (stmtIds.length) {
        await this._request('_releaseStatements', stmtIds)
      }
    }
  }
  getRowsModified(): Promise<number> {
    return this._request('getRowsModified')
  }
  close(): Promise<void> {
    return this._request('close')
  }
  export(): Promise<Uint8Array> {
    return this._request('export')
  }

  // N.b.: we can't pass functions to the worker, so any functions
  // need to be defined and hung off `self` in worker.js.
  async create_function(name: string, fnName?: string): Promise<Database> {
    const result = await this._request('create_function', name, fnName)

    if (!result) {
      if (fnName === undefined) {
        fnName = name
      }

      const msg = `Failed to create \`${fnName}\. ` +
                  `Have you added it to \`self.user_defined_functions\` ` +
                  `in your worker.js?`
      throw new Error(msg)
    }

    return this
  }
}

export interface ElectricMainThreadDatabaseProxy extends MainThreadDatabaseProxy {
  electric: ElectricNamespace
}

export class MainThreadStatementProxy implements Statement {
  db: MainThreadDatabaseProxy
  stmt: string

  _id: string
  _workerClient: WorkerClient

  constructor(id: string, stmt: string, db: MainThreadDatabaseProxy, workerClient: WorkerClient) {
    this.db = db
    this.stmt = stmt

    this._id = id
    this._workerClient = workerClient
  }

  _request(methodName: string, ...args: any[]): Promise<any> {
    const method: StatementMethod = {
      target: 'statement',
      dbName: this.db._dbName,
      statementId: this._id,
      name: methodName
    }

    return this._workerClient.request(method, ...args)
  }

  bind(values: BindParams): Promise<boolean> {
    return this._request('bind', values)
  }
  step(): Promise<boolean> {
    return this._request('step')
  }
  get(params?: BindParams, config?: Config): Promise<SqlValue[]> {
    return this._request('get', params, config)
  }
  getColumnNames(): Promise<string[]> {
    return this._request('getColumnNames')
  }
  getAsObject(params?: BindParams, config?: Config): Promise<Row> {
    return this._request('getAsObject', params, config)
  }
  getSQL(): Promise<string> {
    return this._request('getSQL')
  }
  getNormalizedSQL(): Promise<string> {
    return this._request('getNormalizedSQL')
  }
  run(values: BindParams): Promise<boolean> {
    return this._request('run', values)
  }
  bindFromObject(valuesObj: Row): Promise<true> {
    return this._request('bindFromObject', valuesObj)
  }
  bindFromArray(values: SqlValue[]): Promise<true> {
    return this._request('bindFromArray', values)
  }
  reset(): Promise<boolean> {
    return this._request('reset')
  }
  async free(): Promise<boolean> {
    await this.db._releaseStatement(this._id)

    return true
  }
}

export type ElectrifiedDatabase = ElectricMainThreadDatabaseProxy
