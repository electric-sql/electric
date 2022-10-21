import initSqlJs from '@aphro/sql.js'
import { SQLiteFS } from '@aphro/absurd-sql'
import IndexedDBBackend from '@aphro/absurd-sql/dist/indexeddb-backend'

import { WorkerServer, RequestError } from '../../bridge/index'
import { ElectricNamespace, ElectrifyOptions } from '../../electric/index'
import { BundleMigrator } from '../../migrators/bundle'
import { WorkerBridgeNotifier } from '../../notifiers/bridge'
import { globalRegistry } from '../../satellite/registry'
import { DbName } from '../../util/types'

import { DatabaseAdapter } from './adapter'
import { ElectricDatabase } from './database'
import { WasmLocator } from './locator'
import { WebSocketWeb } from '../../sockets/web'

// Avoid garbage collection.
const refs = []

// Runs in the worker thread and handles the communication with the
// `ElectricDatabase`, mapping postMessages to db method calls.
export class ElectricWorker extends WorkerServer {
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
    const registry = opts.registry || globalRegistry

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

      const adapter = opts.adapter || new DatabaseAdapter(db)
      const migrator = opts.migrator || new BundleMigrator(adapter, opts.migrations)
      const notifier = opts.notifier || new WorkerBridgeNotifier(dbName, this)
      const socket = opts.socket || new WebSocketWeb()

      const namespace = new ElectricNamespace(adapter, notifier)
      this._dbs[dbName] = new ElectricDatabase(db, namespace, this.worker.user_defined_functions)

      await registry.ensureStarted(dbName, adapter, migrator, notifier, socket, this.opts)
    }
    else {
      await registry.ensureAlreadyStarted(dbName)
    }

    return true
  }

  // Static entrypoint allows us to maintain a reference to the
  // instance. Passing opts allows the user to configure.
  static start(worker: Worker, opts: ElectrifyOptions): void {
    const ref = new ElectricWorker(worker, opts)

    refs.push(ref)
  }
}
