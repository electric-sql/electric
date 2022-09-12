import { initBackend } from '@aphro/absurd-sql/dist/indexeddb-main-thread'

import { ServerMethod, WorkerClient } from '../../bridge/index'
import { ElectricNamespace, ElectrifyOptions } from '../../electric/index'
import { MainThreadBridgeNotifier } from '../../notifiers/bridge'
import { proxyOriginal } from '../../proxy/original'
import { DbName } from '../../util/types'

import { DatabaseAdapter } from './adapter'
import { ElectricMainThreadDatabaseProxy, MainThreadDatabaseProxy } from './database'
import { LocateFileOpts, WasmLocator } from './locator'

export { resultToRows } from './result'
export { ElectricWorker } from './worker'

interface SQL {
  openDatabase(dbName: DbName): Promise<ElectricMainThreadDatabaseProxy>
}

export const initElectricSqlJs = async (worker: Worker, locateOpts: LocateFileOpts = {}): Promise<SQL> => {
  initBackend(worker)

  const locator = new WasmLocator(locateOpts)
  const workerClient = new WorkerClient(worker)

  const init: ServerMethod = {
    target: 'server', name: 'init'
  }
  await workerClient.request(init, locator.serialise())

  const openDatabase = async (dbName: DbName, opts: ElectrifyOptions = {}): Promise<ElectricMainThreadDatabaseProxy> => {
    const open: ServerMethod = {
      target: 'server',
      name: 'open'
    }
    await workerClient.request(open, dbName)

    const db = new MainThreadDatabaseProxy(dbName, workerClient)
    const adapter = opts.adapter || new DatabaseAdapter(db)
    const notifier = opts.notifier || new MainThreadBridgeNotifier(dbName, workerClient)
    const namespace = new ElectricNamespace(adapter, notifier)

    return proxyOriginal(db, {electric: namespace}) as ElectricMainThreadDatabaseProxy
  }

  return { openDatabase }
}

// XXX what we really want to do is:
// - instantiate a ProxyClient
// - that provides the SQL.js client API
// - but instead of doing the commands
// - it calls the worker process
// - where the API has an instance of the real client

// the query adapter wrapps the proxyclient in the main thread
// the filesystem and satellite stuff is in the worker thread
// and the notifier machinery needs to go through this req/resp interface
