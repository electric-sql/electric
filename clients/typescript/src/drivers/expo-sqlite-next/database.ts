import { SQLiteDatabase } from 'expo-sqlite/next'

export type Database = Pick<
  SQLiteDatabase,
  'getAllAsync' | 'runAsync' | 'databaseName'
>
