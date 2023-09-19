
export interface ToolbarApiBase {
    getSatelliteNames(): string[]
    getSatelliteStatus(name: string): string
    resetDB(dbName: string): void
}