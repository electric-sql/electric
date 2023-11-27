import { SqlValue, Statement } from './types'

export function isInsertUpdateOrDeleteStatement(stmt: string) {
  return /^\s*(insert|update|delete)/i.test(stmt)
}

/**
 * Prepare multiple batched insert statements for an array of records.
 *
 * Since SQLite only supports a limited amount of positional `?` parameters,
 * we generate multiple insert statements with each one being filled as much
 * as possible from the given data. All statements are derived from same `baseSql` -
 * the positional parameters will be appended to this string.
 *
 * @param baseSql base SQL string to which inserts should be appended
 * @param columns columns that describe records
 * @param records records to be inserted
 * @param maxParameters max parameters this SQLite can accept - determines batching factor
 * @returns array of statements ready to be executed by the adapter
 */
export function prepareInsertBatchedStatements(
  baseSql: string,
  columns: string[],
  records: Record<string, SqlValue>[],
  maxParameters: number
): Statement[] {
  const stmts: Statement[] = []
  const columnCount = columns.length
  const recordCount = records.length
  let processed = 0
  const insertPattern = ' (' + '?, '.repeat(columnCount).slice(0, -2) + '),'

  // Largest number below maxSqlParamers that evenly divides by column count,
  // divided by columnCount, giving the amount of rows we can insert at once
  const batchMaxSize =
    (maxParameters - (maxParameters % columnCount)) / columnCount
  while (processed < recordCount) {
    const currentInsertCount = Math.min(recordCount - processed, batchMaxSize)
    const sql = baseSql + insertPattern.repeat(currentInsertCount).slice(0, -1)
    const args = records
      .slice(processed, processed + currentInsertCount)
      .flatMap((record) => columns.map((col) => record[col] as SqlValue))

    processed += currentInsertCount
    stmts.push({ sql, args })
  }
  return stmts
}
