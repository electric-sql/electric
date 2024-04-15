import { dedent } from 'ts-dedent'
import { SqlValue, Statement } from './types'

export function isInsertUpdateOrDeleteStatement(stmt: string) {
  return /^\s*(insert|update|delete)/i.test(stmt)
}

/**
 * Generates a batched SQL statement for batch inserting records into a table
 * using `json_each` and `json_extract`
 *
 * @param tablename name of the table to insert records into
 * @param columns columns that describe records
 * @param records records to be inserted
 * @param insertCommand - The type of insert command to use (default is 'INSERT')
 * @return {Statement} The generated SQL statement object
 */
export function prepareInsertJsonBatchedStatement(
  tablename: string,
  columns: string[],
  records: Record<string, SqlValue>[],
  insertCommand: 'INSERT' | 'INSERT OR REPLACE' | 'INSERT OR IGNORE' = 'INSERT'
): Statement {
  return {
    sql: dedent`
    ${insertCommand} INTO ${tablename} (${columns.join(', ')})
    SELECT ${columns
      .map((cn) => `json_extract(json_each.value, '$.${cn}')`)
      .join(', ')}
    FROM json_each(?);`,
    args: [JSON.stringify(records)],
  }
}
