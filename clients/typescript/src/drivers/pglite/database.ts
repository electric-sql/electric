import type { PGlite } from '@electric-sql/pglite'

// The relevant subset of the SQLitePlugin database client API
// that we need to ensure the client we're electrifying provides.
export type Database = Pick<PGlite, 'query' | 'dataDir'>
