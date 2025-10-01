/**
 * Default types for SQL but can be extended with additional types when using a custom parser.
 * @typeParam Extensions - Additional value types.
 */
export type Value<Extensions = never> =
  | string
  | number
  | boolean
  | bigint
  | null
  | Extensions
  | Value<Extensions>[]
  | { [key: string]: Value<Extensions> }

export type Row<Extensions = never> = Record<string, Value<Extensions>>

// Check if `T` extends the base Row type without extensions
// if yes, it has no extensions so we return `never`
// otherwise, we infer the extensions from the Row type
export type GetExtensions<T> = [T] extends [Row<never>]
  ? never
  : [T] extends [Row<infer E>]
    ? E
    : never

export type Offset =
  | `-1`
  | `now`
  | `${number}_${number}`
  | `${bigint}_${number}`

/** Information about transaction visibility for a snapshot. All fields are encoded as strings, but should be treated as uint64. */
export type PostgresSnapshot = {
  xmin: `${bigint}`
  xmax: `${bigint}`
  xip_list: `${bigint}`[]
}

export type NormalizedPgSnapshot = {
  xmin: bigint
  xmax: bigint
  xip_list: bigint[]
}

interface Header {
  [key: Exclude<string, `operation` | `control`>]: Value
}

export type Operation = `insert` | `update` | `delete`

export type ControlMessage = {
  headers:
    | (Header & {
        control: `up-to-date` | `must-refetch`
        global_last_seen_lsn?: string
      })
    | (Header & { control: `snapshot-end` } & PostgresSnapshot)
}

export type ChangeMessage<T extends Row<unknown> = Row> = {
  key: string
  value: T
  old_value?: Partial<T> // Only provided for updates if `replica` is `full`
  headers: Header & { operation: Operation; txids?: number[] }
}

// Define the type for a record
export type Message<T extends Row<unknown> = Row> =
  | ControlMessage
  | ChangeMessage<T>

/**
 * Common properties for all columns.
 * `dims` is the number of dimensions of the column. Only provided if the column is an array.
 * `not_null` is true if the column has a `NOT NULL` constraint and is omitted otherwise.
 */
export type CommonColumnProps = {
  dims?: number
  not_null?: boolean
}

export type RegularColumn = {
  type: string
} & CommonColumnProps

export type VarcharColumn = {
  type: `varchar`
  max_length?: number
} & CommonColumnProps

export type BpcharColumn = {
  type: `bpchar`
  length?: number
} & CommonColumnProps

export type TimeColumn = {
  type: `time` | `timetz` | `timestamp` | `timestamptz`
  precision?: number
} & CommonColumnProps

export type IntervalColumn = {
  type: `interval`
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
} & CommonColumnProps

export type IntervalColumnWithPrecision = {
  type: `interval`
  precision?: 0 | 1 | 2 | 3 | 4 | 5 | 6
  fields?: `SECOND`
} & CommonColumnProps

export type BitColumn = {
  type: `bit`
  length: number
} & CommonColumnProps

export type NumericColumn = {
  type: `numeric`
  precision?: number
  scale?: number
} & CommonColumnProps

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

export type TypedMessages<T extends Row<unknown> = Row> = {
  messages: Array<Message<T>>
  schema: ColumnInfo
}

export type MaybePromise<T> = T | Promise<T>

/**
 * Metadata that allows the consumer to know which changes have been incorporated into this snapshot.
 *
 * For any data that has a known transaction ID `xid` (and e.g. a key that's part of the snapshot):
 * - if `xid` < `xmin` - included, change can be skipped
 * - if `xid` < `xmax` AND `xid` not in `xip` - included, change can be skipped
 * - if `xid` < `xmax` AND `xid` in `xip` - parallel, not included, change must be processed
 * - if `xid` >= `xmax` - not included, change must be processed, and we can stop filtering after we see this
 */
export type SnapshotMetadata = {
  /** Random number that's reflected in the `snapshot_mark` header on the snapshot items. */
  snapshot_mark: number
  database_lsn: string
} & PostgresSnapshot
