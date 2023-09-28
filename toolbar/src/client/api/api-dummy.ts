import { ToolbarApiBase } from './api-base'
export type SqlValue = string | number | null | Uint8Array | bigint
export type Row = { [key: string]: SqlValue }

export class ToolbarApiDummy implements ToolbarApiBase {
  getSatelliteNames(): string[] {
    return ['Mary', 'Mungo', 'Midge']
  }

  getSatelliteStatus(_dbName: string): string {
    return 'connected'
  }

  resetDB(dbName: string): void {
    console.log('reset DB: ', dbName)
  }

  queryDB(_dbName: string, _sql: string): Promise<Row[]> {
    return new Promise((resolve, _reject) => {
      resolve([{ thing: 3 }])
    })
  }
}
