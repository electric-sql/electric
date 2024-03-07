import { SQLiteDatabase } from 'react-native-sqlite-storage'

// The relevant subset of the SQLitePlugin database client API
// that we need to ensure the client we're electrifying provides.
export type Database = Pick<SQLiteDatabase, 'dbname' | 'executeSql'>
