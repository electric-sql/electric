import { SQLiteDBConnection } from '@capacitor-community/sqlite'
import { DbName } from '../../util/types'

// A bit of a hack, but that lets us reference the actual types of the library
type OriginalDatabase = SQLiteDBConnection

// The relevant subset of the SQLitePlugin database client API
// that we need to ensure the client we're electrifying provides.
export interface Database
  extends Pick<OriginalDatabase, 'executeSet' | 'run' | 'query'> {
  dbname?: DbName
}
