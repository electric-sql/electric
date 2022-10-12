import { AnyDatabase } from '../drivers/index'
import { QualifiedTablename } from '../util/tablename'
import { Row, Statement } from '../util/types'

// A `DatabaseAdapter` adapts a database client to provide the
// normalised interface defined here.
export interface DatabaseAdapter {
  db: AnyDatabase

  // Runs the provided sql statement
  run(statement: Statement): Promise<void>

  // Runs the provided sql as a transaction
  runTransaction(...statements: Statement[]): Promise<void>

  // Query the database.
  query(statement: Statement): Promise<Row[]>

  // Get the tables potentially used by the query (so that we
  // can re-query if the data in them changes).
  tableNames(statement: Statement): QualifiedTablename[]
}
