import { Row, SqlValue } from '../../util/types'
import { QueryExecResult } from './database'

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
