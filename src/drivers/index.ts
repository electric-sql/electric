import {
  Database as BetterSQLite3Database,
  ElectricDatabase as BetterSQLite3ElectricDatabase
} from './better-sqlite3/database'

import {
  Database as BrowserDatabase,
} from './browser/database'

import {
  Database as CordovaSQLiteStorageDatabase,
  ElectricDatabase as CordovaSQLiteStorageElectricDatabase
} from './cordova-sqlite-storage/database'

import {
  Database as ReactNativeSQLiteStorageDatabase,
  ElectricDatabase as ReactNativeSQLiteStorageElectricDatabase
} from './react-native-sqlite-storage/database'

import {
  Database as GenericDatabase,
  ElectricDatabase as GenericElectricDatabase
} from './generic/database'

export type AnyDatabase =
  BetterSQLite3Database
  | BrowserDatabase
  | CordovaSQLiteStorageDatabase
  | ReactNativeSQLiteStorageDatabase
  | GenericDatabase

export type AnyElectricDatabase =
  BetterSQLite3ElectricDatabase
  | CordovaSQLiteStorageElectricDatabase
  | ReactNativeSQLiteStorageElectricDatabase
  | GenericElectricDatabase
