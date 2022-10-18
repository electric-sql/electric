import {
  Database as AbsurdSQLDatabase,
  ElectricDatabase as AbsurdSQLElectricDatabase,
  ElectricMainThreadDatabaseProxy as AbsurdSQLElectricMainThreadDatabaseProxy,
  ElectrifiedDatabase as AbsurdSQLElectrifiedDatabase
} from './absurd-sql/database'

import {
  Database as BetterSQLite3Database,
  ElectricDatabase as BetterSQLite3ElectricDatabase,
  ElectrifiedDatabase as BetterSQLite3ElectrifiedDatabase
} from './better-sqlite3/database'

import {
  Database as CordovaSQLiteStorageDatabase,
  ElectricDatabase as CordovaSQLiteStorageElectricDatabase,
  ElectrifiedDatabase as CordovaSQLiteStorageElectrifiedDatabase
} from './cordova-sqlite-storage/database'

import {
  Database as ExpoSQLiteDatabase,
  ElectricDatabase as ExpoSQLiteElectricDatabase,
  ElectricWebSQLDatabase as ExpoSQLiteElectricWebSQLDatabase,
  ElectrifiedDatabase as ExpoSQLiteElectrifiedDatabase
} from './expo-sqlite/database'

import {
  Database as ReactNativeSQLiteStorageDatabase,
  ElectricDatabase as ReactNativeSQLiteStorageElectricDatabase,
  ElectrifiedDatabase as ReactNativeSQLiteStorageElectrifiedDatabase
} from './react-native-sqlite-storage/database'

import {
  Database as GenericDatabase,
  ElectricDatabase as GenericElectricDatabase,
  ElectrifiedDatabase as GenericElectrifiedDatabase
} from './generic/index'

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

export type AnyElectrifiedDatabase =
  AbsurdSQLElectrifiedDatabase
  | BetterSQLite3ElectrifiedDatabase
  | CordovaSQLiteStorageElectrifiedDatabase
  | ExpoSQLiteElectrifiedDatabase
  | ReactNativeSQLiteStorageElectrifiedDatabase
  | GenericElectrifiedDatabase

export type AnyWorkerThreadElectricDatabase =
  AbsurdSQLElectricDatabase
