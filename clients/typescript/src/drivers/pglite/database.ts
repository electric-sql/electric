import { PGlite } from '@electric-sql/pglite'

// A bit of a hack, but that lets us reference the actual types of the library
type OriginalDatabase = PGlite

// The relevant subset of the SQLitePlugin database client API
// that we need to ensure the client we're electrifying provides.
export interface Database
  extends Pick<OriginalDatabase, 'exec' | 'query' | 'dataDir'> {
}
