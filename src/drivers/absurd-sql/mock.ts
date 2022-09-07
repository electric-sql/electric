import { AnyFunction, BindParams, DbName, Row, SqlValue } from '../../util/types'

import { DEFAULTS } from '../../electric/config'
import { ElectricNamespace } from '../../electric/index'

import { WorkerServer, RequestError } from '../../bridge/index'
import { MockFilesystem } from '../../filesystems/mock'
import { Notification } from '../../notifiers/index'
import { MockNotifier } from '../../notifiers/mock'
import { globalRegistry } from '../../satellite/registry'

import { Config, Database, ElectricDatabase, QueryExecResult, Statement } from './database'
import { QueryAdapter } from './query'
import { SatelliteDatabaseAdapter } from './satellite'

interface TestData {
  notifications: Notification[]
}

export class MockDatabase implements Database {
  dbName: DbName

  constructor(dbName: DbName) {
    this.dbName = dbName
  }

  exec(_sql: string, _params?: BindParams, _config?: Config): QueryExecResult {
    const dbName = this.dbName

    return {
      columns: ['db', 'val'],
      values: [[dbName, 1], [dbName, 2]]
    }
  }
  run(_sql: string, _params?: BindParams): Database {
    return this
  }
  prepare(sql: string, _params?: BindParams): Statement {
    return new MockStatement(this, sql)
  }
  getRowsModified(): number {
    return 0
  }
  close(): void {}
  export(): Uint8Array {
    return new Uint8Array(2)
  }
  create_function(_name: string, _func?: AnyFunction | string): Database {
    return this
  }
}

export class MockStatement implements Statement {
  db: Database
  stmt: string

  _steps: number
  _maxSteps: number

  constructor(db: Database, stmt: string) {
    this.db = db
    this.stmt = stmt

    this._steps = 0
    this._maxSteps = 3
  }

  bind(_values: BindParams): boolean {
    return true
  }
  step(): boolean {
    this._steps += 1

    return this._steps <= this._maxSteps
  }
  get(_params?: BindParams, _config?: Config): SqlValue[] {
    return [1]
  }
  getColumnNames(): string[] {
    return ['a']
  }
  getAsObject(_params?: BindParams, _config?: Config): Row {
    return {a: 1}
  }
  getSQL(): string {
    return this.stmt
  }
  getNormalizedSQL(): string {
    return this.stmt
  }
  run(_values: BindParams): boolean {
    return true
  }
  bindFromObject(_valuesObj: Row): true {
    return true
  }
  bindFromArray(_values: SqlValue[]): true {
    return true
  }
  reset(): boolean {
    this._steps = 0

    return true
  }
  free(): boolean {
    return true
  }
}

export class MockElectricWorker extends WorkerServer {
  async init(_locatorPattern: string): Promise<boolean> {
    this.SQL = true

    return true
  }

  async open(dbName: DbName): Promise<boolean> {
    if (!this.SQL) {
      throw new RequestError(400, 'Must init before opening')
    }

    const opts = this.opts
    const satelliteRegistry = opts.satelliteRegistry || globalRegistry

    if (!(dbName in this._dbs)) {
      const db = new MockDatabase(dbName)
      const defaultNamespace = opts.defaultNamespace || DEFAULTS.namespace

      const notifier = opts.notifier || new MockNotifier(dbName)
      const fs = opts.filesystem || new MockFilesystem()
      const queryAdapter = opts.queryAdapter || new QueryAdapter(db, defaultNamespace)
      const satelliteDbAdapter = opts.satelliteDbAdapter || new SatelliteDatabaseAdapter(db)

      const namespace = new ElectricNamespace(notifier, queryAdapter)
      this._dbs[dbName] = new ElectricDatabase(db, namespace, this.worker.user_defined_functions)

      await satelliteRegistry.ensureStarted(dbName, satelliteDbAdapter, fs, notifier)
    }
    else {
      await satelliteRegistry.ensureAlreadyStarted(dbName)
    }

    return true
  }

  async _get_test_data(dbName: DbName): Promise<TestData> {
    const db = this._dbs[dbName]
    const notifier = db.electric.notifier as MockNotifier
    const notifications = notifier.notifications

    return {
      notifications: notifications ? notifications : []
    }
  }
}
