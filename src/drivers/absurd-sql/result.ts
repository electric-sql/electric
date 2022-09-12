import { Row, SqlValue } from '../../util/types'
import { QueryExecResult } from './database'

export const resultToRows = (result: QueryExecResult): Row[] => {
  const rows: Row[] = []
  const cols = result.columns

  result.values.map((values: SqlValue[]) => {
    const row: Row = {}

    values.map((val: SqlValue, i: number) => {
      const col = cols[i]

      row[col] = val
    })

    rows.push(row)
  })

  return rows
}
