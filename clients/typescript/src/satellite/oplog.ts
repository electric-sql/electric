import Long from 'long'
import { QualifiedTablename } from '../util/tablename'
import {
  DataChangeType,
  RelationsCache,
  Row,
  SqlValue,
  DataTransaction,
  DataChange,
} from '../util/types'
import { union } from '../util/sets'
import { numberToBytes } from '../util/common'

// format: UUID@timestamp_in_milliseconds
export type Timestamp = string
export type Tag = string

export type ShadowKey = string

// Oplog table schema.
export interface OplogEntry {
  namespace: string
  tablename: string
  primaryKey: string // json object
  rowid: number
  optype: OpType
  timestamp: string // ISO string
  newRow?: string // json object if present
  oldRow?: string // json object if present
  clearTags: string // json object if present
}

// Representation of a change operation.
export interface OplogEntryChanges {
  namespace: string
  tablename: string
  primaryKeyCols: {
    [key: string]: string | number
  }
  optype: ChangesOpType
  changes: OplogColumnChanges
  tag: Tag | null
  clearTags: Tag[]
}

export interface ShadowEntryChanges {
  namespace: string
  tablename: string
  primaryKeyCols: {
    [key: string]: string | number
  }
  optype: ChangesOpType
  changes: OplogColumnChanges
  fullRow: Row
  tags: Tag[]
}

export interface OplogColumnChanges {
  [columnName: string]: {
    value: SqlValue
    timestamp: number // ms since epoch
  }
}

export interface OplogTableChanges {
  [qualifiedTablenameStr: string]: {
    [primaryKey: string]: [Timestamp, OplogEntryChanges]
  }
}

export interface ShadowTableChanges {
  [qualifiedTablenameStr: string]: {
    [primaryKey: string]: ShadowEntryChanges
  }
}

export type OpType = 'DELETE' | 'INSERT' | 'UPDATE'

export type ChangesOpType = 'DELETE' | 'UPSERT'

export const OPTYPES: {
  insert: 'INSERT'
  update: 'UPDATE'
  delete: 'DELETE'
  upsert: 'UPSERT'
} = {
  insert: 'INSERT',
  update: 'UPDATE',
  delete: 'DELETE',
  upsert: 'UPSERT',
}

export interface ShadowEntry {
  namespace: string
  tablename: string
  primaryKey: string
  tags: string // json object
}

export const shadowTagsDefault = '[]'

export const stringToOpType = (opTypeStr: string): OpType => {
  switch (opTypeStr) {
    case 'INSERT':
      return OPTYPES.insert
    case 'UPDATE':
      return OPTYPES.update
    case 'DELETE':
      return OPTYPES.delete
  }
  throw new Error(`unexpected opType string: ${opTypeStr}`)
}

// Convert an `OplogEntry` to an `OplogEntryChanges` structure,
// parsing out the changed columns from the oldRow and the newRow.
export const localEntryToChanges = (
  entry: OplogEntry,
  tag: Tag
): OplogEntryChanges => {
  const result: OplogEntryChanges = {
    namespace: entry.namespace,
    tablename: entry.tablename,
    primaryKeyCols: JSON.parse(entry.primaryKey),
    optype: entry.optype === OPTYPES.delete ? OPTYPES.delete : OPTYPES.upsert,
    changes: {},
    tag: entry.optype == OPTYPES.delete ? null : tag,
    clearTags: decodeTags(entry.clearTags),
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

// Convert an `OplogEntry` to a `ShadowEntryChanges` structure,
// parsing out the changed columns from the oldRow and the newRow.
export const remoteEntryToChanges = (entry: OplogEntry): ShadowEntryChanges => {
  const oldRow: Row = entry.oldRow ? JSON.parse(entry.oldRow) : {}
  const newRow: Row = entry.newRow ? JSON.parse(entry.newRow) : {}

  const result: ShadowEntryChanges = {
    namespace: entry.namespace,
    tablename: entry.tablename,
    primaryKeyCols: JSON.parse(entry.primaryKey),
    optype: entry.optype === OPTYPES.delete ? OPTYPES.delete : OPTYPES.upsert,
    changes: {},
    // if it is a delete, then `newRow` is empty so the full row is the old row
    fullRow: entry.optype === OPTYPES.delete ? oldRow : newRow,
    tags: decodeTags(entry.clearTags),
  }

  const timestamp = new Date(entry.timestamp).getTime()

  for (const [key, value] of Object.entries(newRow)) {
    if (oldRow[key] !== value) {
      result.changes[key] = { value, timestamp }
    }
  }

  return result
}

/**
 * Convert a list of `OplogEntry`s into a nested `OplogTableChanges` map of
 * `{tableName: {primaryKey: entryChanges}}` where the entryChanges has the
 * most recent `optype` and column `value` from all of the operations.
 * Multiple OplogEntries that point to the same row will be merged to a
 * single OpLogEntryChanges object.
 *
 * @param operations Array of local oplog entries.
 * @param genTag Function that generates a tag from a timestamp.
 * @returns An object of oplog table changes.
 */
export const localOperationsToTableChanges = (
  operations: OplogEntry[],
  genTag: (timestamp: Date) => Tag
): OplogTableChanges => {
  const initialValue: OplogTableChanges = {}

  return operations.reduce((acc, entry) => {
    const entryChanges = localEntryToChanges(
      entry,
      genTag(new Date(entry.timestamp))
    )

    // Sort for deterministic key generation.
    const primaryKeyStr = primaryKeyToStr(entryChanges.primaryKeyCols)
    const qualifiedTablename = new QualifiedTablename(
      entryChanges.namespace,
      entryChanges.tablename
    )
    const tablenameStr = qualifiedTablename.toString()

    if (acc[tablenameStr] === undefined) {
      acc[tablenameStr] = {}
    }

    if (acc[tablenameStr][primaryKeyStr] === undefined) {
      acc[tablenameStr][primaryKeyStr] = [entry.timestamp, entryChanges]
    } else {
      const [timestamp, existing] = acc[tablenameStr][primaryKeyStr]
      existing.optype = entryChanges.optype
      for (const [key, value] of Object.entries(entryChanges.changes)) {
        existing.changes[key] = value
      }
      if (entryChanges.optype == 'DELETE') {
        existing.tag = null
      } else {
        existing.tag = genTag(new Date(entry.timestamp))
      }

      if (timestamp == entry.timestamp) {
        // within the same transaction overwirte
        existing.clearTags = entryChanges.clearTags
      } else {
        existing.clearTags = union(entryChanges.clearTags, existing.clearTags)
      }
    }

    return acc
  }, initialValue)
}

export const remoteOperationsToTableChanges = (
  operations: OplogEntry[]
): ShadowTableChanges => {
  const initialValue: ShadowTableChanges = {}

  return operations.reduce((acc, entry) => {
    const entryChanges = remoteEntryToChanges(entry)

    // Sort for deterministic key generation.
    const primaryKeyStr = primaryKeyToStr(entryChanges.primaryKeyCols)
    const qualifiedTablename = new QualifiedTablename(
      entryChanges.namespace,
      entryChanges.tablename
    )
    const tablenameStr = qualifiedTablename.toString()

    if (acc[tablenameStr] === undefined) {
      acc[tablenameStr] = {}
    }
    if (acc[tablenameStr][primaryKeyStr] === undefined) {
      acc[tablenameStr][primaryKeyStr] = entryChanges
    } else {
      const existing = acc[tablenameStr][primaryKeyStr]
      existing.optype = entryChanges.optype
      for (const [key, value] of Object.entries(entryChanges.changes)) {
        existing.changes[key] = value
        existing.fullRow[key] = value.value
      }
    }

    return acc
  }, initialValue)
}

export const fromTransaction = (
  transaction: DataTransaction,
  relations: RelationsCache
): OplogEntry[] => {
  return transaction.changes.map((t) => {
    const columnValues = t.record ? t.record : t.oldRecord!
    const pk = primaryKeyToStr(
      Object.fromEntries(
        relations[`${t.relation.table}`].columns
          .filter((c) => c.primaryKey)
          .map((col) => [col.name, columnValues[col.name]!])
      )
    )

    return {
      namespace: 'main', // TODO: how?
      tablename: t.relation.table,
      optype: stringToOpType(t.type),
      newRow: JSON.stringify(t.record),
      oldRow: JSON.stringify(t.oldRecord),
      primaryKey: pk,
      rowid: -1, // not required
      timestamp: new Date(
        transaction.commit_timestamp.toNumber()
      ).toISOString(), // TODO: check precision
      clearTags: encodeTags(t.tags),
    }
  })
}

export const toTransactions = (
  opLogEntries: OplogEntry[],
  relations: RelationsCache
): DataTransaction[] => {
  if (opLogEntries.length == 0) {
    return []
  }

  const to_commit_timestamp = (timestamp: string): Long =>
    Long.UZERO.add(new Date(timestamp).getTime())

  const init: DataTransaction = {
    commit_timestamp: to_commit_timestamp(opLogEntries[0].timestamp),
    lsn: numberToBytes(opLogEntries[0].rowid),
    changes: [],
  }

  return opLogEntries.reduce(
    (acc, txn) => {
      let currTxn = acc[acc.length - 1]

      const nextTs = to_commit_timestamp(txn.timestamp)
      if (nextTs.notEquals(currTxn.commit_timestamp as Long)) {
        const nextTxn = {
          commit_timestamp: to_commit_timestamp(txn.timestamp),
          lsn: numberToBytes(txn.rowid),
          changes: [],
        }
        acc.push(nextTxn)
        currTxn = nextTxn
      }

      const change = opLogEntryToChange(txn, relations)
      currTxn.changes.push(change)
      currTxn.lsn = numberToBytes(txn.rowid)
      return acc
    },
    [init]
  )
}

export const newShadowEntry = (oplogEntry: OplogEntry): ShadowEntry => {
  return {
    namespace: oplogEntry.namespace,
    tablename: oplogEntry.tablename,
    primaryKey: primaryKeyToStr(JSON.parse(oplogEntry.primaryKey)),
    tags: shadowTagsDefault,
  }
}

export const getShadowPrimaryKey = (
  oplogEntry: OplogEntry | OplogEntryChanges | ShadowEntryChanges
): ShadowKey => {
  if ('primaryKey' in oplogEntry) {
    return oplogEntry.primaryKey
  } else {
    return primaryKeyToStr(oplogEntry.primaryKeyCols)
  }
}

export const encodeTags = (tags: Tag[]): string => {
  return JSON.stringify(tags)
}

export const decodeTags = (tags: string): Tag[] => {
  return JSON.parse(tags)
}

export const opLogEntryToChange = (
  entry: OplogEntry,
  relations: RelationsCache
): DataChange => {
  let record, oldRecord
  if (entry.newRow != null) {
    record = JSON.parse(entry.newRow)
  }

  if (entry.oldRow != null) {
    oldRecord = JSON.parse(entry.oldRow)
  }

  const relation = relations[`${entry.tablename}`]

  if (typeof relation === 'undefined') {
    throw new Error(`Could not find relation for ${entry.tablename}`)
  }

  return {
    type: entry.optype as DataChangeType,
    relation: relation,
    record,
    oldRecord,
    tags: decodeTags(entry.clearTags),
  }
}

/**
 * Convert a primary key to a string the same way our triggers do when generating oplog entries.
 *
 * Takes the object that contains the primary key and serializes it to JSON in a non-prettified
 * way with column sorting.
 *
 * @param primaryKeyObj object representing all columns of a primary key
 * @returns a stringified JSON with stable sorting on column names
 */
export const primaryKeyToStr = (primaryKeyObj: {
  [key: string]: string | number
}): string => {
  const keys = Object.keys(primaryKeyObj).sort()
  if (keys.length === 0) return '{}'

  let json = '{'
  for (const key of keys) {
    json += JSON.stringify(key) + ':' + JSON.stringify(primaryKeyObj[key]) + ','
  }

  // Remove the last appended comma and close the object
  return json.slice(0, -1) + '}'
}

export const generateTag = (instanceId: string, timestamp: Date): Tag => {
  const milliseconds = timestamp.getTime()
  return instanceId + '@' + milliseconds.toString()
}
