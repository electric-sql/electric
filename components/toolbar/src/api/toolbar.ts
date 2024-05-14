import {
  DbTableInfo,
  DebugShape,
  ToolbarInterface,
  UnsubscribeFunction,
} from './interface'
import { Row, Statement, ConnectivityState } from 'electric-sql/util'
import {
  Registry,
  GlobalRegistry,
  Satellite,
  Shape,
} from 'electric-sql/satellite'
import { SubscriptionsManager } from 'electric-sql/satellite/shapes'
import {
  getDbTables,
  getElectricTables,
  getSqlDialect,
  SqlDialect,
} from './statements'

export class Toolbar implements ToolbarInterface {
  private dialectMap: Record<string, SqlDialect> = {}
  constructor(private registry: Registry | GlobalRegistry) {}

  private getSatellite(name: string): Satellite {
    const sat = this.registry.satellites[name]
    if (!sat) {
      throw new Error(`Satellite for db ${name} not found.`)
    }
    return sat
  }

  getSatelliteNames(): string[] {
    return Object.keys(this.registry.satellites)
  }

  getSatelliteStatus(name: string): ConnectivityState | null {
    const sat = this.getSatellite(name)
    return sat.connectivityState ?? null
  }

  subscribeToSatelliteStatus(
    name: string,
    callback: (connectivityState: ConnectivityState) => void,
  ): UnsubscribeFunction {
    const sat = this.getSatellite(name)

    // call once immediately if connectivity state available
    if (sat.connectivityState) {
      callback(sat.connectivityState)
    }
    // subscribe to subsequent changes
    return sat.notifier.subscribeToConnectivityStateChanges((notification) =>
      callback(notification.connectivityState),
    )
  }

  toggleSatelliteStatus(name: string): Promise<void> {
    const sat = this.getSatellite(name)
    if (sat.connectivityState?.status === 'connected') {
      sat.clientDisconnect()
      return Promise.resolve()
    }
    return sat.connectWithBackoff()
  }

  getSatelliteShapeSubscriptions(name: string): DebugShape[] {
    const sat = this.getSatellite(name)
    //@ts-expect-error accessing private field
    const manager = sat['subscriptions'] as SubscriptionsManager
    const shapes = JSON.parse(manager.serialize()) as Record<
      string,
      { definition: Shape }[]
    >
    return Object.entries(shapes).flatMap((shapeKeyDef) =>
      shapeKeyDef[1].map((x) => ({
        id: shapeKeyDef[0],
        ...x.definition,
      })),
    )
  }

  resetDb(dbName: string): Promise<void> {
    const DBDeleteRequest = window.indexedDB.deleteDatabase(dbName)
    DBDeleteRequest.onsuccess = () =>
      console.log('Database deleted successfully')

    // the IndexedDB cannot be deleted if the database connection is still open,
    // so we need to reload the page to close any open connections.
    // On reload, the database will be recreated.
    window.location.reload()
    return Promise.resolve()
  }

  queryDb(dbName: string, statement: Statement): Promise<Row[]> {
    const sat = this.getSatellite(dbName)
    return sat.adapter.query(statement)
  }

  async getDbDialect(name: string): Promise<SqlDialect> {
    if (!this.dialectMap[name]) {
      this.dialectMap[name] = await getSqlDialect(
        this.getSatellite(name).adapter,
      )
    }
    return this.dialectMap[name]
  }

  async getDbTables(dbName: string): Promise<DbTableInfo[]> {
    const adapter = this.getSatellite(dbName).adapter
    const dialect = await this.getDbDialect(dbName)
    return getDbTables(adapter, dialect)
  }

  async getElectricTables(dbName: string): Promise<DbTableInfo[]> {
    const adapter = this.getSatellite(dbName).adapter
    const dialect = await this.getDbDialect(dbName)
    return getElectricTables(adapter, dialect)
  }

  subscribeToDbTable(
    dbName: string,
    tableName: string,
    callback: () => void,
  ): UnsubscribeFunction {
    const sat = this.getSatellite(dbName)
    const unsubscribe = sat.notifier.subscribeToDataChanges((notification) => {
      if (notification.dbName !== dbName) return
      for (const change of notification.changes) {
        if (
          change.qualifiedTablename.tablename === tableName ||
          // always trigger an update if subscribing to internal tables
          tableName.startsWith('_electric')
        ) {
          callback()
          return
        }
      }
    })

    return unsubscribe
  }
}
