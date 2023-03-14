import { initBackend } from '@aphro/absurd-sql/dist/indexeddb-main-thread'

import { ServerMethod, WorkerClient } from '../../bridge/index'
import { ElectricConfig } from '../../config/index'
import { ElectrifyOptions } from '../../electric/index'
import { ElectricNamespace } from '../../electric/namespace'
import { MainThreadBridgeNotifier } from '../../notifiers/bridge'
import { DbName } from '../../util/types'

import { DatabaseAdapter } from './adapter'
import { MainThreadDatabaseProxy } from './database'
import { LocateFileOpts, WasmLocator } from './locator'
import { DalNamespace, DbSchemas } from '../../client/model/dalNamespace'

export { WasmLocator }
export type { LocateFileOpts }

export {
  ElectricDatabase,
  ElectricStatement,
  MainThreadDatabaseProxy,
  MainThreadStatementProxy,
} from './database'

export type {
  Config,
  QueryExecResult,
  Database,
  Statement,
  StatementIterator,
  ElectrifiedDatabase,
} from './database'

export { resultToRows } from './result'
export { ElectricWorker } from './worker'

export interface SQL {
  openDatabase<S extends DbSchemas>(
    dbName: DbName,
    dbSchemas: S,
    config: ElectricConfig
  ): Promise<DalNamespace<S>>
}

export const initElectricSqlJs = async (
  worker: Worker,
  locateOpts: LocateFileOpts = {}
): Promise<SQL> => {
  initBackend(worker)

  const locator = new WasmLocator(locateOpts)
  const workerClient = new WorkerClient(worker)

  const init: ServerMethod = {
    target: 'server',
    name: 'init',
  }

  await workerClient.request(init, locator.serialise())

  const openDatabase = async <S extends DbSchemas>(
    dbName: DbName,
    dbSchemas: S,
    config: ElectricConfig,
    opts?: ElectrifyOptions
  ): Promise<DalNamespace<S>> => {
    const open: ServerMethod = {
      target: 'server',
      name: 'open',
    }
    await workerClient.request(open, dbName, config)

    const db = new MainThreadDatabaseProxy(dbName, workerClient)
    const adapter = opts?.adapter || new DatabaseAdapter(db)
    const notifier =
      opts?.notifier || new MainThreadBridgeNotifier(dbName, workerClient)
    const electric = new ElectricNamespace(adapter, notifier)
    const namespace = DalNamespace.create(dbSchemas, electric)

    return namespace
  }

  return { openDatabase }
}
