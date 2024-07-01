export type DbName = string
export type SqlValue =
  | boolean
  | string
  | number
  | Uint8Array
  | undefined
  | null
  | bigint
export type Row = { [key: string]: SqlValue }
export type BindParams = SqlValue[] | Row
export type Statement = { sql: string; args?: SqlValue[] }
