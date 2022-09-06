// Generic database clients need to mark themselves with the
// `isGenericDatabase` / `isGenericElectricDatabase` feature.

export interface Database {
  databaseFeatures: {
    isGenericDatabase: true
  }
}

export interface ElectricDatabase {
  databaseFeatures: {
    isGenericElectricDatabase: true
  }
}
