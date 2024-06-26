export type DbName = string
export type SqlValue =
  | boolean
  | string
  | number
  | bigint
  | Uint8Array
  | undefined
  | null
export type Row = { [key: string]: SqlValue }
export type BindParams = SqlValue[] | Row
export type Statement = { sql: string; args?: SqlValue[] }
