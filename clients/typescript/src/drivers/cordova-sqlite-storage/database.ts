import { DbName } from '../../util/types'

// A bit of a hack, but that lets us reference the actual types of the library
type OriginalDatabase = SQLitePlugin.Database

// The relevant subset of the SQLitePlugin database client API
// that we need to ensure the client we're electrifying provides.
export interface Database
  extends Pick<
    OriginalDatabase,
    'executeSql' | 'transaction' | 'readTransaction' | 'sqlBatch'
  > {
  // Cordova calls the database name `.dbname` using camel case.
  // this is different to React Native which uses `.dbname`.
  dbname?: DbName
}
