// Generic database clients need to mark themselves with the
// `isGenericDatabase` / `isGenericElectricDatabase` feature.
import { ElectricNamespace } from '../../electric/index'

export interface Database {
  isGenericDatabase: true
}

export interface ElectricDatabase {
  isGenericElectricDatabase: true

  electric: ElectricNamespace
}

export interface ElectrifiedDatabase extends Database, ElectricDatabase {}
