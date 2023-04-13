import { Row, SqlValue } from '../../util/types'

export interface Results {
  rows: {
    item(i: number): Row
    length: number
    raw?(): Row[]
  }
  rowsAffected: number
  insertId?: number
}

export interface QueryExecResult {
  columns: string[]
  values: SqlValue[][]
}

export const rowsFromResults = (results: Results): Row[] => {
  if (results.rows.raw) {
    return results.rows.raw()
  }

  const rows = []
  for (let i = 0; i < results.rows.length; i++) {
    rows.push(results.rows.item(i))
  }

  return rows
}

export const resultToRows = (result: QueryExecResult[]): Row[] => {
  const rows: Row[] = []
  if (result.length == 0) {
    return rows
  }

  for (const res of result) {
    const cols = res.columns
    res.values.map((values: SqlValue[]) => {
      const row: Row = {}

      values.map((val: SqlValue, i: number) => {
        const col = cols[i]

        row[col] = val
      })

      rows.push(row)
    })
  }

  return rows
}

export const mockResults = (rows: Row[]): Results => {
  return {
    rows: {
      item: (i: number) => rows[i],
      length: rows.length,
      raw: () => rows,
    },
    rowsAffected: 0,
  }
}
