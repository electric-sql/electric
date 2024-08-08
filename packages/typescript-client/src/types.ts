export type Value =
  | string
  | number
  | boolean
  | bigint
  | null
  | Value[]
  | { [key: string]: Value }

export type Offset = `-1` | `${number}_${number}`

interface Header {
  [key: string]: Value
}

export type ControlMessage = {
  headers: Header
}

export type ChangeMessage<T> = {
  key: string
  value: T
  headers: Header & { operation: `insert` | `update` | `delete` }
  offset: Offset
}

// Define the type for a record
export type Message<T extends Value = { [key: string]: Value }> =
  | ControlMessage
  | ChangeMessage<T>

export type RegularColumn = {
  type: string
  dims: number
}

export type VarcharColumn = {
  type: `varchar`
  dims: number
  max_length?: number
}

export type BpcharColumn = {
  type: `bpchar`
  dims: number
  length?: number
}

export type TimeColumn = {
  type: `time` | `timetz` | `timestamp` | `timestamptz`
  dims: number
  precision?: number
}

export type IntervalColumn = {
  type: `interval`
  dims: number
  fields?:
    | `YEAR`
    | `MONTH`
    | `DAY`
    | `HOUR`
    | `MINUTE`
    | `YEAR TO MONTH`
    | `DAY TO HOUR`
    | `DAY TO MINUTE`
    | `DAY TO SECOND`
    | `HOUR TO MINUTE`
    | `HOUR TO SECOND`
    | `MINUTE TO SECOND`
}

export type IntervalColumnWithPrecision = {
  type: `interval`
  dims: number
  precision?: 0 | 1 | 2 | 3 | 4 | 5 | 6
  fields?: `SECOND`
}

export type BitColumn = {
  type: `bit`
  dims: number
  length: number
}

export type NumericColumn = {
  type: `numeric`
  dims: number
  precision?: number
  scale?: number
}

export type ColumnInfo =
  | RegularColumn
  | VarcharColumn
  | BpcharColumn
  | TimeColumn
  | IntervalColumn
  | IntervalColumnWithPrecision
  | BitColumn
  | NumericColumn

export type Schema = { [key: string]: ColumnInfo }

export type TypedMessages<T extends Value = { [key: string]: Value }> = {
  messages: Array<Message<T>>
  schema: ColumnInfo
}
