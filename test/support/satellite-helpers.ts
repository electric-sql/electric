import { DatabaseAdapter } from '../../src/electric/adapter'
import { OplogEntry, OpType, OPTYPES } from '../../src/satellite/oplog'
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
      columns: ['id', 'value', 'otherValue'],
    },
    'main.child': {
      primaryKey: ['id'],
      columns: ['id', 'parent'],
    },
    'main.items': {
      primaryKey: ['value'],
      columns: ['value', 'otherValue'],
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

export const generateOplogEntry = (
  info: TableInfo,
  namespace: string,
  tablename: string,
  optype: OpType,
  timestamp: number,
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
