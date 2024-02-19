import { ToolbarInterface } from './interface'
import { Row, Statement, ConnectivityState } from 'electric-sql/util'
import { Registry, GlobalRegistry } from 'electric-sql/satellite'

export class Toolbar implements ToolbarInterface {
  private registry: Registry | GlobalRegistry

  constructor(registry: Registry | GlobalRegistry) {
    this.registry = registry
  }

  getSatelliteNames(): string[] {
    return Object.keys(this.registry.satellites)
  }

  getSatelliteStatus(name: string): ConnectivityState | 'Not found' {
    const sat = this.registry.satellites[name]
    return sat?.connectivityState ?? 'Not found'
  }

  resetDB(dbName: string): Promise<void> {
    const DBDeleteRequest = window.indexedDB.deleteDatabase(dbName)
    DBDeleteRequest.onsuccess = function () {
      console.log('Database deleted successfully')
    }
    // the indexedDB cannot be deleted if the database connection is still open,
    // so we need to reload the page to close any open connections.
    // On reload, the database will be recreated.
    window.location.reload()
    return new Promise((resolve) => resolve())
  }

  queryDB(dbName: string, statement: Statement): Promise<Row[]> {
    const sat = this.registry.satellites[dbName]
    return (
      sat?.adapter.query(statement) ??
      Promise.reject("Couldn't query satellite")
    )
  }
}
