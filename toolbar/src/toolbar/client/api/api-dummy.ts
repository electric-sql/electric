import { ToolbarApiBase } from './api-base'

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
}
