export type DbName = string
export type SqlValue = string | number | null | Uint8Array | bigint
export type Row = { [key: string]: SqlValue }
export type BindParams = SqlValue[] | Row
export type Statement = { sql: string; args?: SqlValue[] }
