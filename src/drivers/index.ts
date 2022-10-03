import {
  Database as AbsurdSQLDatabase,
  ElectricDatabase as AbsurdSQLElectricDatabase,
  ElectricMainThreadDatabaseProxy as AbsurdSQLElectricMainThreadDatabaseProxy
} from './absurd-sql/database'

import {
  Database as BetterSQLite3Database,
  ElectricDatabase as BetterSQLite3ElectricDatabase
} from './better-sqlite3/database'

import {
  Database as CordovaSQLiteStorageDatabase,
  ElectricDatabase as CordovaSQLiteStorageElectricDatabase
} from './cordova-sqlite-storage/database'

import {
  Database as ExpoSQLiteDatabase,
  ElectricDatabase as ExpoSQLiteElectricDatabase,
  ElectricWebSQLDatabase as ExpoSQLiteElectricWebSQLDatabase,
} from './expo-sqlite/database'

import {
  Database as ReactNativeSQLiteStorageDatabase,
  ElectricDatabase as ReactNativeSQLiteStorageElectricDatabase
} from './react-native-sqlite-storage/database'

import {
  Database as GenericDatabase,
  ElectricDatabase as GenericElectricDatabase
} from './generic/database'

export type AnyDatabase =
  AbsurdSQLDatabase
  | BetterSQLite3Database
  | CordovaSQLiteStorageDatabase
  | ExpoSQLiteDatabase
  | ReactNativeSQLiteStorageDatabase
  | GenericDatabase

export type AnyElectricDatabase =
  AbsurdSQLElectricDatabase
  | AbsurdSQLElectricMainThreadDatabaseProxy
  | BetterSQLite3ElectricDatabase
  | CordovaSQLiteStorageElectricDatabase
  | ExpoSQLiteElectricDatabase
  | ExpoSQLiteElectricWebSQLDatabase
  | ReactNativeSQLiteStorageElectricDatabase
  | GenericElectricDatabase

export type AnyWorkerThreadElectricDatabase =
  AbsurdSQLElectricDatabase
