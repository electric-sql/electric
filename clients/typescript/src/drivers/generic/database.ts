import { Statement } from '../../util'
import { Row } from '../../util/types'

/**
 * Interface that must be implemented by a database driver
 * in order to wrap it in the generic database adapter.
 */
export interface Database {
  name: string
  /**
   * Executes a SQL statement against the database.
   */
  exec(statement: Statement): Promise<Row[]>
  /**
   * Returns the number of rows that were inserted/modified/deleted
   * by the most recent SQL statement.
   */
  getRowsModified(): number
}
