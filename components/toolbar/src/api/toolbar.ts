import {
  DbTableInfo,
  DebugShape,
  TableColumn,
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

export class Toolbar implements ToolbarInterface {
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

  async getDbTables(dbName: string): Promise<DbTableInfo[]> {
    const adapter = this.getSatellite(dbName).adapter
    const tables = (await adapter.query({
      sql: `
      SELECT name, sql FROM sqlite_master WHERE type='table'
        AND name NOT LIKE 'sqlite_%'
        AND name NOT LIKE '_electric_%'`,
    })) as unknown as Omit<DbTableInfo, 'columns'>[]

    return Promise.all(
      tables.map(async (tbl) => ({
        ...tbl,
        columns: await this.getTableColumns(dbName, tbl.name),
      })),
    )
  }

  async getElectricTables(dbName: string): Promise<DbTableInfo[]> {
    const adapter = this.getSatellite(dbName).adapter
    const tables = (await adapter.query({
      sql: `
      SELECT name, sql FROM sqlite_master WHERE type='table'
        AND name LIKE '_electric_%'`,
    })) as unknown as Omit<DbTableInfo, 'columns'>[]

    return Promise.all(
      tables.map(async (tbl) => ({
        ...tbl,
        columns: await this.getTableColumns(dbName, tbl.name),
      })),
    )
  }
  private async getTableColumns(
    dbName: string,
    tableName: string,
  ): Promise<TableColumn[]> {
    const adapter = this.getSatellite(dbName).adapter
    const columns = await adapter.query({
      sql: `PRAGMA table_info(${tableName})`,
    })
    return columns.map((c) => ({
      name: c.name,
      type: c.type,
    })) as TableColumn[]
  }
}
