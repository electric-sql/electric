import { Row, Offset } from '@electric-sql/client'

export interface SSRShapeData<T extends Row<unknown>> {
  rows: [string, T][] // Array of [key, value] tuples
  lastSyncedAt: number | undefined
  offset: Offset | undefined
  handle: string | undefined
}

export interface SSRState {
  shapes: { [key: string]: SSRShapeData<any> }
}
