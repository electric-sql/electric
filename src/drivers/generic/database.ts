// Generic database clients need to mark themselves with the
// `isGenericDatabase` / `isGenericElectricDatabase` feature.
import { ElectricNamespace } from '../../electric/index'

export interface Database {
  databaseFeatures: {
    isGenericDatabase: true
  }
}

export interface ElectricDatabase {
  databaseFeatures: {
    isGenericElectricDatabase: true
  }

  electric: ElectricNamespace
}
