import { initBackend } from '@aphro/absurd-sql/dist/indexeddb-main-thread'

import { ServerMethod, WorkerClient } from '../../bridge/index'
import { ElectricNamespace, ElectrifyOptions } from '../../electric/index'
import { MainThreadBridgeNotifier } from '../../notifiers/bridge'
import { proxyOriginal } from '../../proxy/original'
import { ElectricConfig } from '../../satellite/config'
import { DbName } from '../../util/types'

import { DatabaseAdapter } from './adapter'
import { ElectrifiedDatabase, MainThreadDatabaseProxy } from './database'
import { LocateFileOpts, WasmLocator } from './locator'

export { WasmLocator }
export type { LocateFileOpts }

export {
  ElectricDatabase,
  ElectricStatement,
  MainThreadDatabaseProxy,
  MainThreadStatementProxy
} from './database'

export type {
  Config,
  QueryExecResult,
  Database,
  Statement,
  StatementIterator,
  ElectrifiedDatabase
} from './database'

export { resultToRows } from './result'
export { ElectricWorker } from './worker'

export interface SQL {
  openDatabase(dbName: DbName, config: ElectricConfig): Promise<ElectrifiedDatabase>
}

export const initElectricSqlJs = async (worker: Worker, locateOpts: LocateFileOpts = {}): Promise<SQL> => {
  initBackend(worker)

  const locator = new WasmLocator(locateOpts)
  const workerClient = new WorkerClient(worker)

  const init: ServerMethod = {
    target: 'server', name: 'init'
  }
  await workerClient.request(init, locator.serialise())

  const openDatabase = async (dbName: DbName, config: ElectricConfig, opts?: ElectrifyOptions): Promise<ElectrifiedDatabase> => {
    const open: ServerMethod = {
      target: 'server',
      name: 'open'
    }
    await workerClient.request(open, dbName, config)

    const db = new MainThreadDatabaseProxy(dbName, workerClient)
    const adapter = opts?.adapter || new DatabaseAdapter(db)
    const notifier = opts?.notifier || new MainThreadBridgeNotifier(dbName, workerClient)
    const namespace = new ElectricNamespace(adapter, notifier)

    return proxyOriginal(db, {electric: namespace}) as ElectrifiedDatabase
  }

  return { openDatabase }
}
