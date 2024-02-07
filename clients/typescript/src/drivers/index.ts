import { Database as BetterSQLite3Database } from './better-sqlite3/database'

import { Database as CordovaSQLiteStorageDatabase } from './cordova-sqlite-storage/database'

import { Database as ExpoSQLiteDatabase } from './expo-sqlite/database'

import { Database as WASQLiteDatabase } from './wa-sqlite/database'

import { Database as ReactNativeSQLiteStorageDatabase } from './react-native-sqlite-storage/database'

import { Database as CapacitorSQLiteDatabase } from './capacitor-sqlite/database'

import { Database as NodePostgresDatabase } from './node-postgres/database'

import { Database as TauriPostgresDatabase } from './tauri-postgres/database'

export type AnyDatabase =
  | BetterSQLite3Database
  | CordovaSQLiteStorageDatabase
  | ExpoSQLiteDatabase
  | ReactNativeSQLiteStorageDatabase
  | WASQLiteDatabase
  | CapacitorSQLiteDatabase
  | NodePostgresDatabase
  | TauriPostgresDatabase
