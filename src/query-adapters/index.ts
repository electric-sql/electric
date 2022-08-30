import { AnyDatabase } from '../adapters/index'
import { QualifiedTablename } from '../util/tablename'
import { BindParams, DbNamespace, Query } from '../util/types'

// Query adapters adapt a database client to provide the normalised
// interface defined here. This allows clients to be used in a
// standardised way by our reactive hook machinery.
export interface QueryAdapter {
  db: AnyDatabase
  defaultNamespace: DbNamespace

  // Run the query.
  perform(query: Query, bindParams?: BindParams): Promise<any>

  // Get the names of all the tables potentially used by the query.
  // (so that we can re-query if the data in them changes).
  tableNames(query: Query): QualifiedTablename[]
}
