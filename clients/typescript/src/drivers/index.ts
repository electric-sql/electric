import { Database as BetterSQLite3Database } from './better-sqlite3/database.js'

import { Database as CordovaSQLiteStorageDatabase } from './cordova-sqlite-storage/database.js'

import { Database as ExpoSQLiteDatabase } from './expo-sqlite/database.js'

import { Database as WASQLiteDatabase } from './wa-sqlite/database.js'

import { Database as ReactNativeSQLiteStorageDatabase } from './react-native-sqlite-storage/database.js'

import { Database as CapacitorSQLiteDatabase } from './capacitor-sqlite/database.js'

export type AnyDatabase =
  | BetterSQLite3Database
  | CordovaSQLiteStorageDatabase
  | ExpoSQLiteDatabase
  | ReactNativeSQLiteStorageDatabase
  | WASQLiteDatabase
  | CapacitorSQLiteDatabase
