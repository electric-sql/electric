import initSqlJs from '@aphro/sql.js'
import { SQLiteFS } from '@aphro/absurd-sql'
import IndexedDBBackend from '@aphro/absurd-sql/dist/indexeddb-backend'

import { DEFAULTS } from '../../electric/config'
import { ElectricNamespace, ElectrifyOptions } from '../../electric/index'
import { BrowserFilesystem } from '../../filesystems/browser'
import { EmitCommitNotifier } from '../../notifiers/emit'
import { globalRegistry } from '../../satellite/registry'
import { DbName } from '../../util/types'

import { BaseWorkerServer, RequestError } from './bridge'
import { ElectricDatabase } from './database'
import { WasmLocator } from './locator'
import { QueryAdapter } from './query'
import { SatelliteDatabaseAdapter } from './satellite'

// Avoid garbage collection.
const refs = []

// Runs in the worker thread and handles the communication with the
// `ElectricDatabase`, mapping postMessages to db method calls.
export class ElectricWorker extends BaseWorkerServer {
  async init(locatorPattern: string): Promise<boolean> {
    const locateFileFn = WasmLocator.deserialise(locatorPattern)

    const SQL = await initSqlJs({ locateFile: locateFileFn })
    const sqlFS = new SQLiteFS(SQL.FS, new IndexedDBBackend())

    SQL.register_for_idb(sqlFS)

    SQL.FS.mkdir('/electric-sql')
    SQL.FS.mount(sqlFS, {}, '/electric-sql')

    this.SQL = SQL

    return true
  }

  async open(dbName: DbName): Promise<boolean> {
    if (this.SQL === undefined) {
      throw new RequestError(400, 'Must init before opening')
    }

    const opts = this.opts
    const satelliteRegistry = opts.satelliteRegistry || globalRegistry

    if (!(dbName in this._dbs)) {
      const SQL = this.SQL
      const path = `/electric-sql/${dbName}`

      if (typeof SharedArrayBuffer === 'undefined') {
        const stream = SQL.FS.open(path, 'a+')
        await stream.node.contents.readIfFallback()
        SQL.FS.close(stream)
      }

      const db = new SQL.Database(path, {filename: true})
      db.exec(`PRAGMA journal_mode=MEMORY; PRAGMA page_size=8192;`)

      const defaultNamespace = opts.defaultNamespace || DEFAULTS.namespace
      const commitNotifier = opts.commitNotifier || new EmitCommitNotifier(dbName)
      const fs = opts.filesystem || new BrowserFilesystem()
      const queryAdapter = opts.queryAdapter || new QueryAdapter(db, defaultNamespace)
      const satelliteDbAdapter = opts.satelliteDbAdapter || new SatelliteDatabaseAdapter(db)

      const namespace = new ElectricNamespace(commitNotifier, queryAdapter)
      this._dbs[dbName] = new ElectricDatabase(db, namespace, this.worker.user_defined_functions)

      await satelliteRegistry.ensureStarted(dbName, satelliteDbAdapter, fs)
    }
    else {
      await satelliteRegistry.ensureAlreadyStarted(dbName)
    }

    return true
  }

  // Static entrypoint allows us to maintain a reference to the
  // instance. Passing opts allows the user to configure.
  static start(worker: Worker, opts: ElectrifyOptions = {}):void {
    const ref = new ElectricWorker(worker, opts)

    refs.push(ref)
  }
}
