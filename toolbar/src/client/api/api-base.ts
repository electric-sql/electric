export type SqlValue = string | number | null | Uint8Array | bigint
export type Row = { [key: string]: SqlValue }

export interface ToolbarApiBase {
  getSatelliteNames(): string[]
  getSatelliteStatus(name: string): string
  resetDB(dbName: string): void
  queryDB(dbName: string, sql: string): Promise<Row[]>
  // evalTs(dbName: string, code: string)
}
