import { ToolbarApiBase } from './api-base'
import { GlobalRegistry } from 'electric-sql/satellite'
export type SqlValue = string | number | null | Uint8Array | bigint
export type Row = { [key: string]: SqlValue }
// import * as ts from "typescript"

export class ToolbarApiTypescript implements ToolbarApiBase {
  private globalRegistry: GlobalRegistry

  constructor(globalRegistry: GlobalRegistry) {
    this.globalRegistry = globalRegistry
  }

  getSatelliteNames(): string[] {
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

  async queryDB(dbName: string, sql: string): Promise<Row[]> {
    let sat = this.globalRegistry.satellites[dbName]
    if (sat === undefined) {
      return []
    } else {
      return sat.adapter.query({ sql: sql })
    }
  }

  //
  // evalTs(dbName: string, input: string) {
  //   let sat = this.globalRegistry.satellites[dbName]
  //   if (sat === undefined) {
  //
  //   } else {
  //     let db = sat
  //     let code: string = `({
  //   Run: (data: string): string => {
  //       return ` + input + ` }
  //   })`;
  //
  //     let result = ts.transpile(code);
  //     let runnalbe: any = eval(result);
  //     result = runnalbe.Run("RUN!")
  //     console.log(result);
  //
  //   }
  // }
}
