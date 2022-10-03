import { AnyDatabase } from '../drivers/index'
import { QualifiedTablename } from '../util/tablename'
import { BindParams, Query, Row } from '../util/types'

// A `DatabaseAdapter` adapts a database client to provide the
// normalised interface defined here.
export interface DatabaseAdapter {
  db: AnyDatabase

  // Runs the provided sql.
  run(sql: string): Promise<void>

  // Query the database.
  query(query: Query, bindParams?: BindParams): Promise<Row[]>

  // Get the tables potentially used by the query (so that we
  // can re-query if the data in them changes).
  tableNames(query: Query): QualifiedTablename[]
}
