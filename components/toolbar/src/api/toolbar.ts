import { ToolbarInterface, UnsubscribeFunction } from './interface'
import { Row, Statement, ConnectivityState } from 'electric-sql/util'
import { Registry, GlobalRegistry } from 'electric-sql/satellite'

export class Toolbar implements ToolbarInterface {
  constructor(private registry: Registry | GlobalRegistry) {}

  getSatelliteNames(): string[] {
    return Object.keys(this.registry.satellites)
  }

  getSatelliteStatus(name: string): ConnectivityState | null {
    const sat = this.registry.satellites[name]
    if (!sat) {
      throw new Error(`Satellite for db ${name} not found.`)
    }
    return sat.connectivityState ?? null
  }

  subscribeToSatelliteStatus(
    name: string,
    callback: (connectivityState: ConnectivityState) => void,
  ): UnsubscribeFunction {
    const sat = this.registry.satellites[name]
    if (!sat) {
      throw new Error(`Satellite for db ${name} not found.`)
    }

    // call once immediately if connectivity state available
    if (sat.connectivityState) {
      callback(sat.connectivityState)
    }
    // subscribe to subsequent changes
    return sat.notifier.subscribeToConnectivityStateChanges((notification) =>
      callback(notification.connectivityState),
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
    const sat = this.registry.satellites[dbName]
    return (
      sat?.adapter.query(statement) ??
      Promise.reject("Couldn't query satellite")
    )
  }
}
