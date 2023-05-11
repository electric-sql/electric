import type { DbName } from '../../util'
import type {
  Database as OriginalDatabase,
  WebSQLDatabase as OriginalWebSQLDatabase,
} from 'expo-sqlite'
export type { SQLTransaction as Transaction } from 'expo-sqlite'

export type Database = (OriginalDatabase | OriginalWebSQLDatabase) & {
  _name?: DbName
}
