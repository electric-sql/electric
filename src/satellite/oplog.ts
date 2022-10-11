import Long from 'long'
import { QualifiedTablename } from '../util/tablename'
import { Change, ChangeType, RelationsCache, Row, SqlValue, Transaction } from '../util/types'
import { encoder } from '../util/common'

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
  primaryKeyCols: {
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

export const stringToOpType = (opTypeStr: string): OpType => {
  switch (opTypeStr) {
    case 'INSERT': return OPTYPES.insert
    case 'UPDATE': return OPTYPES.update
    case 'DELETE': return OPTYPES.delete
  }
  throw new Error(`unexpected opType string: ${opTypeStr}`)
}

// Convert an `OplogEntry` to an `OplogEntryChanges` structure,
// parsing out the changed columns from the oldRow and the newRow.
export const entryToChanges = (entry: OplogEntry): OplogEntryChanges => {
  const result: OplogEntryChanges = {
    namespace: entry.namespace,
    tablename: entry.tablename,
    primaryKeyCols: JSON.parse(entry.primaryKey),
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
    const primaryKeyStr = Object.values(entryChanges.primaryKeyCols).sort().join('_')
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

export const fromTransaction = (transaction: Transaction, relations: RelationsCache): OplogEntry[] => {
  return transaction.changes.map(t => {
    const columnValues = t.record ? t.record : t.oldRecord
    const pk = JSON.stringify(Object.fromEntries(
      relations[`${t.relation.table}`].columns
        .filter(c => c.primaryKey)
        .map(col => [col.name, columnValues![col.name]])
    ))

    return ({
      namespace: "main", // TODO: how?
      tablename: t.relation.table,
      optype: stringToOpType(t.type),
      newRow: JSON.stringify(t.record),
      oldRow: JSON.stringify(t.oldRecord),
      primaryKey: pk,
      rowid: -1, // not required
      timestamp: new Date(transaction.commit_timestamp.toNumber()).toISOString() // TODO: check precision
    })
  })
}

export const toTransactions = (opLogEntries: OplogEntry[], relations: RelationsCache): Transaction[] => {
  if (opLogEntries.length == 0) {
    return []
  }

  const to_commit_timestamp = (timestamp: string): Long =>
    Long.UZERO.add(new Date(timestamp).getTime())

  const opLogEntryToChange = (entry: OplogEntry): Change => {
    let record, oldRecord
    if (entry.newRow != null) {
      record = JSON.parse(entry.newRow)
    }

    if (entry.oldRow != null) {
      oldRecord = JSON.parse(entry.oldRow)
    }

    // is it okay to lose UPDATE at this point? Does Vaxine care about it?
    return {
      type: entry.optype == 'DELETE' ? ChangeType.DELETE : ChangeType.INSERT,
      relation: relations[`${entry.tablename}`],
      record,
      oldRecord
    }
  }

  const init: Transaction = {
    commit_timestamp: to_commit_timestamp(opLogEntries[0].timestamp),
    lsn: encoder.encode(opLogEntries[0].rowid.toString()),
    changes: [],
  }

  return opLogEntries.reduce((acc, txn) => {
    let currTxn = acc[acc.length - 1]

    const nextTs = to_commit_timestamp(txn.timestamp)
    if (nextTs.notEquals(currTxn.commit_timestamp as Long)) {
      const nextTxn = {
        commit_timestamp: to_commit_timestamp(txn.timestamp),
        lsn: encoder.encode(txn.rowid.toString()),
        changes: [],
      }
      acc.push(nextTxn)
      currTxn = nextTxn
    }

    const change = opLogEntryToChange(txn)
    currTxn.changes.push(change)
    currTxn.lsn = encoder.encode(txn.rowid.toString())
    return acc
  }, [init])
}
