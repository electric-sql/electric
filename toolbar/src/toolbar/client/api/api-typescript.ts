import { ToolbarApiBase } from './api-base'
import { GlobalRegistry } from 'electric-sql/satellite'

export class ToolbarApiTypescript implements ToolbarApiBase {
  private globalRegistry: GlobalRegistry

  constructor(globalRegistry: GlobalRegistry) {
    this.globalRegistry = globalRegistry
  }

  getSatelliteNames(): string[] {
    console.log('getSatelliteNames rrr')
    console.log(this.globalRegistry)
    return Object.keys(this.globalRegistry.satellites)
  }

  getSatelliteStatus(name: string): string {
    let sat = this.globalRegistry.satellites[name]
    if (sat === undefined) {
      return ''
    } else {
      let state = sat['connectivityState']
      if (state === undefined) {
        return ''
      } else {
        return state
      }
    }
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
}
