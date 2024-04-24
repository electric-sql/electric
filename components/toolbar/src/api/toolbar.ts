import { ToolbarInterface, UnsubscribeFunction } from './interface'
import { Row, Statement, ConnectivityState } from 'electric-sql/util'
import { Registry, GlobalRegistry, Satellite } from 'electric-sql/satellite'
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

  getSatelliteShapeSubscriptions(name: string): string[] {
    const sat = this.getSatellite(name)
    //@ts-expect-error accessing private field
    const manager = sat['subscriptions'] as SubscriptionsManager
    const shapes = JSON.parse(manager.serialize()) as Record<string, any>
    return Object.values(shapes).flatMap((shapeDef) =>
      shapeDef.map((x: any) => JSON.stringify(x.definition)),
    )
  }

  resetDB(dbName: string): Promise<void> {
    const DBDeleteRequest = window.indexedDB.deleteDatabase(dbName)
    DBDeleteRequest.onsuccess = () =>
      console.log('Database deleted successfully')

    // the IndexedDB cannot be deleted if the database connection is still open,
    // so we need to reload the page to close any open connections.
    // On reload, the database will be recreated.
    window.location.reload()
    return Promise.resolve()
  }

  queryDB(dbName: string, statement: Statement): Promise<Row[]> {
    const sat = this.getSatellite(dbName)
    return sat.adapter.query(statement)
  }
}
