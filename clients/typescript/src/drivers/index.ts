import { Database as BetterSQLite3Database } from './better-sqlite3/database'

import { Database as CordovaSQLiteStorageDatabase } from './cordova-sqlite-storage/database'

import { Database as ExpoSQLiteDatabase } from './expo-sqlite/database'

import { Database as ExpoSQLiteNextDatabase } from './expo-sqlite-next/database'

import { Database as WASQLiteDatabase } from './wa-sqlite/database'

import { Database as ReactNativeSQLiteStorageDatabase } from './react-native-sqlite-storage/database'

import { Database as CapacitorSQLiteDatabase } from './capacitor-sqlite/database'

export type AnyDatabase =
  | BetterSQLite3Database
  | CordovaSQLiteStorageDatabase
  | ExpoSQLiteDatabase
  | ExpoSQLiteNextDatabase
  | ReactNativeSQLiteStorageDatabase
  | WASQLiteDatabase
  | CapacitorSQLiteDatabase
