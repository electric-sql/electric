import { DatabaseAdapter } from '../../src/electric/adapter'
import {
  OplogEntry,
  OpType,
  OPTYPES,
  shadowTagsDefault,
  generateTag,
  encodeTags,
} from '../../src/satellite/oplog'
import { Row } from '../../src/util/types'

export interface TableInfo {
  [key: string]: TableSchema
}

interface TableSchema {
  primaryKey: string[]
  columns: string[]
}

export const initTableInfo = (): TableInfo => {
  return {
    'main.parent': {
      primaryKey: ['id'],
      columns: ['id', 'value', 'other'],
    },
    'main.child': {
      primaryKey: ['id'],
      columns: ['id', 'parent'],
    },
    'main.Items': {
      primaryKey: ['value'],
      columns: ['value', 'other'],
    },
  }
}

export const loadSatelliteMetaTable = async (
  db: DatabaseAdapter,
  metaTableName = '_electric_meta'
): Promise<Row> => {
  const rows = await db.query({
    sql: `SELECT key, value FROM ${metaTableName}`,
  })
  const entries = rows.map((x) => [x.key, x.value])

  return Object.fromEntries(entries)
}

export const generateOplogEntries = (
  info: TableInfo,
  namespace: string,
  tablename: string,
  changes: any
): OplogEntry[] => {
  return changes.map((change: any) =>
    generateLocalOplogEntry(
      info,
      namespace,
      tablename,
      change.optype,
      change.timestamp,
      change.newValues,
      change.oldValues,
      change.clearTags
    )
  )
}

// This function should be only used to represent incoming transaction, not local
// transactions, as we treat cleatTags differently for incoming transactions.
export const generateLocalOplogEntry = (
  info: TableInfo,
  namespace: string,
  tablename: string,
  optype: OpType,
  timestamp: number,
  clearTags: string | undefined,
  newValues: Row = {},
  oldValues: Row = {}
): OplogEntry => {
  const schema = info[namespace + '.' + tablename]
  if (schema === undefined) {
    throw new Error('Schema is undefined')
  }

  const newRow = generateFrom(schema, newValues)

  let oldRow: ReturnType<typeof generateFrom> = {}
  if (optype === OPTYPES.update || optype === OPTYPES.delete) {
    oldRow = generateFrom(schema, oldValues)
  }
  let tags = clearTags
  if (optype == OPTYPES.delete && clearTags == undefined) {
    tags = shadowTagsDefault
  }
  if (optype != OPTYPES.delete && clearTags == undefined) {
    tags = encodeTags([generateTag('remote', new Date(timestamp))])
  }

  const result: OplogEntry = {
    namespace,
    tablename,
    optype,
    rowid: timestamp,
    newRow: JSON.stringify(newRow.columns),
    oldRow: JSON.stringify(oldRow.columns),
    primaryKey: JSON.stringify({ ...oldRow.primaryKey, ...newRow.primaryKey }),
    timestamp: new Date(timestamp).toISOString(),
    clearTags: tags as string,
  }

  return result
}

export const generateRemoteOplogEntry = (
  info: TableInfo,
  namespace: string,
  tablename: string,
  optype: OpType,
  timestamp: number,
  incomingTags: string,
  newValues: Row = {},
  oldValues: Row = {}
): OplogEntry => {
  const schema = info[namespace + '.' + tablename]
  if (schema === undefined) {
    throw new Error('Schema is undefined')
  }

  const newRow = generateFrom(schema, newValues)

  let oldRow: ReturnType<typeof generateFrom> = {}
  if (optype === OPTYPES.update || optype === OPTYPES.delete) {
    oldRow = generateFrom(schema, oldValues)
  }

  const result: OplogEntry = {
    namespace,
    tablename,
    optype,
    rowid: timestamp,
    newRow: JSON.stringify(newRow.columns),
    oldRow: JSON.stringify(oldRow.columns),
    primaryKey: JSON.stringify({ ...oldRow.primaryKey, ...newRow.primaryKey }),
    timestamp: new Date(timestamp).toISOString(),
    clearTags: incomingTags as string,
  }

  return result
}

const generateFrom = (
  schema: TableSchema,
  values: Row
): { columns?: Row; primaryKey?: Row } => {
  const columns = schema.columns.reduce((acc, column) => {
    if (values[column] !== undefined) {
      acc[column] = values[column]
    }

    return acc
  }, {} as Row)

  const primaryKey = schema.primaryKey.reduce((acc, column) => {
    if (values[column] !== undefined) {
      acc[column] = values[column]
    }

    return acc
  }, {} as Row)

  return { columns, primaryKey }
}

export const genEncodedTags = (
  origin: string,
  dates: Date[] | number[]
): string => {
  let tags = dates.map((date) => {
    if (date instanceof Date) {
      return generateTag(origin, date)
    } else {
      return generateTag(origin, new Date(date))
    }
  })
  return encodeTags(tags)
}
