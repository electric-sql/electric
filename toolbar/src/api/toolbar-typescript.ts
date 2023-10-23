import { ToolbarInterface } from './toolbar-interface'
import { Row, Statement, ConnectivityState } from 'electric-sql/dist/util'
import { GlobalRegistry } from 'electric-sql/satellite'

export class ToolbarTypescript implements ToolbarInterface {
  private globalRegistry: GlobalRegistry

  constructor(globalRegistry: GlobalRegistry) {
    this.globalRegistry = globalRegistry
  }

  getSatelliteNames(): string[] {
    return Object.keys(this.globalRegistry.satellites)
  }

  getSatelliteStatus(name: string): ConnectivityState | 'Not found' {
    const sat = this.globalRegistry.satellites[name]
    return sat?.connectivityState ?? 'Not found'
  }

  resetDB(dbName: string): void {
    const DBDeleteRequest = window.indexedDB.deleteDatabase(dbName)
    DBDeleteRequest.onsuccess = function () {
      console.log('Database deleted successfully')
    }
    // the indexedDB cannot be deleted if the database connection is still open,
    // so we need to reload the page to close any open connections.
    // On reload, the database will be recreated.
    window.location.reload()
  }

  queryDB(dbName: string, statement: Statement): Promise<Row[]> {
    const sat = this.globalRegistry.satellites[dbName]
    return sat?.adapter.query(statement) ?? Promise.resolve([])
  }
}
