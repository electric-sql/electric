import { QualifiedTablename } from '../util/tablename'
import { Row, SqlValue } from '../util/types'

// Oplog table schema.
export interface OplogEntry {
  namespace: string,
  tablename: string,
  primaryKey: string,
  rowid: number,
  optype: OpType,
  timestamp: string, // ISO string
  newRow?: string,
  oldRow?: string
}

// Representation of a change operation.
export interface OplogEntryChanges {
  namespace: string,
  tablename: string,
  primaryKeys: {
    [key: string]: string | number
  },
  optype: 'DELETE' | 'UPSERT',
  changes: OplogColumnChanges
}

export interface OplogColumnChanges {
  [columnName: string]: {
    value: SqlValue,
    timestamp: number, // ms since epoch
  }
}

export interface OplogTableChanges {
  [qualifiedTablenameStr: string]: {
    [primaryKey: string]: OplogEntryChanges
  }
}

export type OpType =
  'DELETE'
  | 'INSERT'
  | 'UPDATE'
  | 'UPSERT'

export const OPTYPES: {
  insert: 'INSERT',
  update: 'UPDATE',
  delete: 'DELETE',
  upsert: 'UPSERT'
} = {
  insert: 'INSERT',
  update: 'UPDATE',
  delete: 'DELETE',
  upsert: 'UPSERT'
}

// Convert an `OplogEntry` to an `OplogEntryChanges` structure,
// parsing out the changed columns from the oldRow and the newRow.
export const entryToChanges = (entry: OplogEntry): OplogEntryChanges => {
  const result: OplogEntryChanges = {
    namespace: entry.namespace,
    tablename: entry.tablename,
    primaryKeys: JSON.parse(entry.primaryKey),
    optype: entry.optype === OPTYPES.delete
      ? OPTYPES.delete
      : OPTYPES.upsert,
    changes: {}
  }

  const oldRow: Row = entry.oldRow ? JSON.parse(entry.oldRow) : {}
  const newRow: Row = entry.newRow ? JSON.parse(entry.newRow) : {}

  const timestamp = new Date(entry.timestamp).getTime()

  for (const [key, value] of Object.entries(newRow)) {
    if (oldRow[key] !== value) {
      result.changes[key] = { value, timestamp }
    }
  }

  return result
}

// Convert a list of `OplogEntry`s into a nested `OplogTableChanges` map of
// `{tableName: {primaryKey: entryChanges}}` where the entryChanges has the
// most recent `optype` and column `value`` from all of the operations.
export const operationsToTableChanges = (operations: OplogEntry[]): OplogTableChanges => {
  const initialValue: OplogTableChanges = {}

  return operations.reduce((acc, entry) => {
    const entryChanges = entryToChanges(entry)

    // Sort for deterministic key generation.
    const primaryKeyStr = Object.values(entryChanges.primaryKeys).sort().join('_')
    const qualifiedTablename = new QualifiedTablename(entryChanges.namespace, entryChanges.tablename)
    const tablenameStr = qualifiedTablename.toString()

    if (acc[tablenameStr] === undefined) {
      acc[tablenameStr] = {}
    }

    if (acc[tablenameStr][primaryKeyStr] === undefined) {
      acc[tablenameStr][primaryKeyStr] = entryChanges
    }
    else {
      const existing = acc[tablenameStr][primaryKeyStr]

      existing.optype = entryChanges.optype
      for (const [key, value] of Object.entries(entryChanges.changes)) {
        existing.changes[key] = value;
      }
    }

    return acc
  }, initialValue)
}
