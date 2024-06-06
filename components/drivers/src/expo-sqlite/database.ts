import { SQLiteDatabase } from 'expo-sqlite'

export type Database = Pick<SQLiteDatabase, 'execRawQuery' | '_name'>
