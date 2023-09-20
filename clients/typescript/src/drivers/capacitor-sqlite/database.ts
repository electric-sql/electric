import { SQLiteDBConnection } from '@capacitor-community/sqlite'
import { DbName } from '../../util/types'

// A bit of a hack, but that lets us reference the actual types of the library
// TODO: Is this the type we want to expose?
type OriginalDatabase = SQLiteDBConnection;

// The relevant subset of the SQLitePlugin database client API
// that we need to ensure the client we're electrifying provides.
// TODO: verify which functions we actually need.
export interface Database
  extends Pick<
    OriginalDatabase,
    'execute' | 'executeTransaction' | 'query' | 'run'
  > {
  // Cordova calls the database name `.dbname` using camel case.
  // this is different to React Native which uses `.dbname`.
  // TODO: understand this???
  dbname?: DbName
}
