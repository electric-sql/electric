import { Row } from '../../util/types'
import { SQLitePluginTransaction } from './index'

export type ExecutionResult = [
  SQLitePluginTransaction,
  Results
]

export interface Results {
  rows: {
    item(i: number): Row
    length: number
    raw?() : Row[]
  }
  rowsAffected: number
  insertId?: number
}

export const rowsFromResults = (results: Results): Row[] => {
  if (!!results.rows.raw) {
    return results.rows.raw()
  }

  const rows = []
  for (let i = 0; i < results.rows.length; i++) {
    rows.push(results.rows.item(i))
  }

  return rows
}
